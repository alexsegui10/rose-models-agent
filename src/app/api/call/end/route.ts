import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSpanishCallSummary } from "@/application/callSummary";
import { analyzeCallTranscript } from "@/application/callTranscriptAnalysis";
import { getInstagramConfig } from "@/application/instagramConfig";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { bearerMatches } from "@/server/bearerAuth";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";

/**
 * Webhook de FIN de llamada: lo invoca la plataforma de voz cuando la llamada termina. Ruta fina
 * (regla ui-api): autentica, normaliza el payload, valida, delega en `engine.recordCallOutcome` y responde.
 *
 * Acepta DOS formas, para funcionar tanto con el post-call webhook NATIVO de ElevenLabs como con un proxy
 * propio:
 *  - AUTH: firma HMAC en el header `ElevenLabs-Signature` (t=<ts>,v0=<hmac sha256 de "ts.body">) O un
 *    `Authorization: Bearer <CALL_WEBHOOK_SECRET>` (proxy propio / pruebas). Ambos usan CALL_WEBHOOK_SECRET.
 *  - BODY: el shape NATIVO de ElevenLabs ({ data: { status, metadata.call_duration_secs, transcript,
 *    analysis.transcript_summary, conversation_initiation_client_data.dynamic_variables.candidate_id } }) O
 *    el shape PLANO ({ candidateId, status, summary, durationSec, transcript }).
 *
 * El `candidateId` se envió como variable dinámica (`candidate_id`) al iniciar la llamada saliente y
 * ElevenLabs lo devuelve en el webhook. NOTA: el formato exacto de ElevenLabs debe confirmarse con una
 * llamada real; por eso se aceptan ambos shapes y se loguea lo que llega.
 */

export const runtime = "nodejs";
// Techo de tiempo explicito (fin de llamada: guarda grabacion/resultado, avisa, reagenda): evita que Vercel
// corte a mitad. Solo sube el limite, no cambia logica.
export const maxDuration = 60;

const EndCallSchema = z
  .object({
    // Opcional a propósito: las llamadas de PRUEBA (/api/call/test) no llevan candidata y el webhook debe
    // responder 200 (skipped), no un 4xx — ElevenLabs DESACTIVA el webhook tras fallos repetidos y eso
    // rompería el registro de TODAS las llamadas reales (hallazgo voz-02, jul-2026).
    candidateId: z.string().optional(),
    status: z.string().min(1),
    summary: z.string().optional(),
    durationSec: z.number().int().nonnegative().optional(),
    negotiatedModelShare: z.number().int().min(0).max(100).optional(),
    conversationId: z.string().optional(),
    transcript: z.array(z.object({ role: z.string(), content: z.string() })).optional()
  })
  .passthrough();

const NO_ANSWER_STATUSES = new Set([
  "no-answer",
  "no_answer",
  "noanswer",
  "busy",
  "failed",
  "missed",
  "unanswered",
  "not-answered",
  "declined",
  "rejected",
  "voicemail",
  "timeout",
  "canceled",
  "cancelled",
  "initiated", // la candidata no llegó a contestar la solicitud de permiso
  "no_response"
]);

function outcomeFromStatus(status: string): "COMPLETED" | "NO_ANSWER" {
  return NO_ANSWER_STATUSES.has(status.trim().toLowerCase()) ? "NO_ANSWER" : "COMPLETED";
}

/**
 * Red de seguridad anti-buzon: si HAY transcripcion (el bot hablo) pero la candidata no dijo NADA, es casi
 * seguro un contestador/buzon. Complementa la deteccion de buzon NATIVA de ElevenLabs (system tool
 * "voicemail detection", que Alex activa en el agente). Sin transcripcion NO asumimos nada (se confia en el
 * status), para no marcar como buzon una llamada real cuyo transcript no llego.
 */
function looksLikeVoicemail(transcript?: Array<{ role: string; content: string }>): boolean {
  if (!transcript || transcript.length === 0) return false;
  const candidateSpoke = transcript.some((turn) => {
    const role = turn.role.trim().toLowerCase();
    return (role === "user" || role === "candidate" || role === "human") && turn.content.trim().length > 0;
  });
  return !candidateSpoke;
}

function hmacHex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function safeHexEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Tolerancia de FRESCURA del timestamp firmado (anti-replay, jul-2026 voz-08): 30 min cubre reintentos
// legítimos del webhook sin dejar la ventana de replay ilimitada que había antes.
const SIGNATURE_MAX_AGE_SECONDS = 30 * 60;

/** Verifica la firma HMAC del webhook de ElevenLabs ("t=<ts>,v0=<hmac>"). Tolera el hex pelado por si acaso. */
function elevenLabsSignatureValid(header: string, rawBody: string, secret: string, nowMs = Date.now()): boolean {
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((kv) => kv.split("="))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()])
  );
  const ts = parts.t;
  const sig = parts.v0 ?? parts.v1;
  if (ts && sig) {
    // Frescura: un timestamp firmado hace más de 30 min (o del futuro lejano) se rechaza (anti-replay).
    const tsSeconds = Number(ts);
    if (!Number.isFinite(tsSeconds) || Math.abs(nowMs / 1000 - tsSeconds) > SIGNATURE_MAX_AGE_SECONDS) {
      return false;
    }
    return safeHexEqual(hmacHex(secret, `${ts}.${rawBody}`), sig);
  }
  // Header sin formato t=/v0=: probar el hex del body pelado (proxy propio; sin ts no hay chequeo de frescura).
  return safeHexEqual(hmacHex(secret, rawBody), header.trim());
}

type EndPayload = z.infer<typeof EndCallSchema>;

/** Normaliza el payload anidado de ElevenLabs al shape plano que consume el motor. */
function normalizeEndPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  if (!data || typeof data !== "object") return raw; // ya es plano (proxy / pruebas)

  const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const d = rec(data);
  const cic = rec(d.conversation_initiation_client_data);
  const metadata = rec(d.metadata);
  const analysis = rec(d.analysis);
  const dynVars = rec(cic.dynamic_variables ?? metadata.dynamic_variables ?? d.dynamic_variables);
  const transcript = Array.isArray(d.transcript)
    ? (d.transcript as unknown[])
        .map((t) => {
          const tr = rec(t);
          return { role: String(tr.role ?? "unknown"), content: String(tr.message ?? tr.content ?? "") };
        })
        .filter((t) => t.content.length > 0)
    : undefined;

  const normalized: Record<string, unknown> = {
    candidateId: obj.candidateId ?? dynVars.candidate_id ?? dynVars.candidateId,
    status: d.status ?? obj.status ?? "completed",
    summary: analysis.transcript_summary ?? d.summary ?? obj.summary,
    durationSec: metadata.call_duration_secs ?? d.call_duration_secs ?? obj.durationSec,
    // conversation_id para poder escuchar la grabación en el CRM (llega fiable en el webhook de fin).
    conversationId: d.conversation_id ?? obj.conversationId ?? metadata.conversation_id ?? cic.conversation_id,
    transcript: transcript ?? obj.transcript
  };
  return normalized;
}

export async function POST(request: Request) {
  const secret = process.env.CALL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "call webhook not configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get("elevenlabs-signature");
  const authed = signatureHeader
    ? elevenLabsSignatureValid(signatureHeader, rawBody, secret)
    : bearerMatches(request.headers.get("authorization"), secret);
  if (!authed) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = EndCallSchema.safeParse(normalizeEndPayload(body));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const payload: EndPayload = parsed.data;

  // Llamada de PRUEBA (sin candidata) o candidata desconocida: 200 "skipped" a propósito. Un 4xx repetido
  // haría que ElevenLabs desactivara el webhook y dejaríamos de registrar TODAS las llamadas reales.
  if (!payload.candidateId) {
    console.warn("[call-end] webhook sin candidate_id (llamada de prueba): se ignora sin error");
    return NextResponse.json({ skipped: true, reason: "sin candidateId (llamada de prueba)" });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();
  const existing = await repository.findCandidateById(payload.candidateId);
  if (!existing) {
    console.warn("[call-end] webhook para candidata desconocida: se ignora sin error", {
      candidateId: payload.candidateId
    });
    return NextResponse.json({ skipped: true, reason: "candidata desconocida" });
  }

  // Buzon de voz: si el status dice completada pero la candidata no dijo nada (solo hablo el bot), se trata
  // como NO_ANSWER -> reintento, y NO se marca como hecha ni se le manda el contrato a un contestador.
  let outcome = outcomeFromStatus(payload.status);
  if (outcome === "COMPLETED" && looksLikeVoicemail(payload.transcript)) {
    outcome = "NO_ANSWER";
  }
  // Hechos DETERMINISTAS del transcript (jul-2026, hallazgos voz-01/voz-03): menor declarada EN la llamada
  // -> CERRADA (invariante 2); handoff (pide persona/agresión/rechazó el suelo) -> revisión humana; % al que
  // quedó la negociación -> ficha. Los decide el CÓDIGO con el mismo replay del cerebro en vivo.
  const transcriptFacts = analyzeCallTranscript(payload.transcript);
  // LA EVIDENCIA MANDA SOBRE LA ETIQUETA (3-jul, llamada real de Alex): ElevenLabs marcó "failed" una
  // llamada de 2:59 con conversación completa (el colgado SIP de Zadarma) -> falso NO CONTESTA -> el bot
  // RE-LLAMÓ a quien ya había cerrado con contrato. Si el status dice fallo pero el transcript demuestra
  // conversación real (ella habló varias veces y duró >= 1 min), la llamada FUE atendida: COMPLETED.
  // El buzón sigue siendo NO_ANSWER (cero turnos de ella, no pasa este umbral).
  if (
    outcome === "NO_ANSWER" &&
    transcriptFacts.candidateTurns >= 2 &&
    typeof payload.durationSec === "number" &&
    payload.durationSec >= 60
  ) {
    console.warn("[call-end] status de fallo con conversación real: se registra COMPLETED (evidencia sobre etiqueta)", {
      status: payload.status,
      candidateTurns: transcriptFacts.candidateTurns,
      durationSec: payload.durationSec
    });
    outcome = "COMPLETED";
  }
  // Resumen EN ESPAÑOL y determinista, construido desde el replay (jul-2026): el transcript_summary de
  // ElevenLabs llega en inglés y no se muestra (queda en su dashboard; aquí solo se loguea que existía).
  const summaryEs = buildSpanishCallSummary({ outcome, durationSec: payload.durationSec, facts: transcriptFacts });
  if (payload.summary) {
    console.log("[call-end] resumen de ElevenLabs (EN) sustituido por el resumen español determinista");
  }
  const result = await engine.recordCallOutcome({
    candidateId: payload.candidateId,
    outcome,
    summary: summaryEs,
    durationSec: payload.durationSec,
    negotiatedModelShare: payload.negotiatedModelShare,
    conversationId: payload.conversationId,
    transcript: payload.transcript,
    transcriptFacts
  });

  // REAGENDAR VIVO (jul-2026, decisión de Alex): si la llamada pilló a la candidata en mal momento, el
  // motor la dejó en COLLECTING_CALL_DETAILS y PERSISTIÓ el mensaje proactivo; aquí se ENVÍA por Instagram
  // (mismo patrón motor-guarda/ruta-envía). Best-effort: si el envío falla, el mensaje queda en el CRM y
  // ella misma puede escribir (el bot ya está despierto para reagendar).
  if (result.followUpMessage && result.transitions.length > 0) {
    try {
      const igConfig = getInstagramConfig();
      if (igConfig.isConfigured) {
        const provider = new GraphApiInstagramMessagingProvider(igConfig);
        // humanAgentTag: el último DM de la candidata suele ser de hace >24h (agendó ayer); sin la
        // etiqueta, Meta rechazaría el RESPONSE y la promesa de la voz ("te escribo por IG") no llegaría.
        await provider.sendTextMessage(result.candidate.instagramUsername, result.followUpMessage, {
          humanAgentTag: true
        });
      }
    } catch (error) {
      console.warn("[call-end] no se pudo enviar el mensaje de reagendado por IG", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // Aviso a Alex (best-effort, nunca rompe el webhook): la llamada terminó necesitando SU decisión. Solo si
  // la transición OCURRIÓ en este webhook (transitions no vacío): un no-op sobre una ya cerrada no avisa.
  if (
    result.transitions.length > 0 &&
    (result.candidate.currentState === "HUMAN_INTERVENTION_REQUIRED" || result.candidate.currentState === "CLOSED")
  ) {
    const reason =
      result.candidate.currentState === "CLOSED"
        ? "SEGURIDAD: declaró ser MENOR durante la llamada; quedó cerrada."
        : "La llamada terminó transferida a ti (pidió persona / agresión / rechazó el suelo del reparto): revisa la ficha.";
    try {
      await getOperatorNotifier().notify({
        kind: "escalation",
        conversationId: result.candidate.instagramUsername,
        state: result.candidate.currentState,
        reason
      });
    } catch {
      /* best-effort */
    }
  }

  // Reintento automatico: si no contesto y quedan intentos, recordCallOutcome reprogramo la hora (+30 min);
  // aqui re-encolamos el auto-marcador (QStash) para esa hora. Best-effort: si QStash falla NO rompe el
  // webhook (Alex puede llamar a mano); la dedup por candidata+hora evita el doble-encolado.
  if (result.shouldRetryCall) {
    try {
      await enqueueCallDispatchIfScheduled({
        candidate: result.candidate,
        origin: new URL(request.url).origin,
        nowMs: Date.now()
      });
    } catch (error) {
      // Best-effort: si QStash falla, la candidata queda reprogramada pero sin auto-marcador encolado
      // (Alex puede llamar a mano). Se loguea para observabilidad (sin secretos).
      console.warn("[call-end] no se pudo re-encolar el reintento", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return NextResponse.json({
    candidate: result.candidate,
    appliedTransitions: result.transitions,
    outcome
  });
}
