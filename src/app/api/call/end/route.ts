import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { bearerMatches } from "@/server/bearerAuth";

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

const EndCallSchema = z
  .object({
    candidateId: z.string().min(1),
    status: z.string().min(1),
    summary: z.string().optional(),
    durationSec: z.number().int().nonnegative().optional(),
    negotiatedModelShare: z.number().int().min(0).max(100).optional(),
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

/** Verifica la firma HMAC del webhook de ElevenLabs ("t=<ts>,v0=<hmac>"). Tolera el hex pelado por si acaso. */
function elevenLabsSignatureValid(header: string, rawBody: string, secret: string): boolean {
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
    return safeHexEqual(hmacHex(secret, `${ts}.${rawBody}`), sig);
  }
  // Header sin formato t=/v0=: probar el hex del body pelado.
  return safeHexEqual(hmacHex(secret, rawBody), header.trim());
}

type EndPayload = z.infer<typeof EndCallSchema>;

/** Normaliza el payload anidado de ElevenLabs al shape plano que consume el motor. */
function normalizeEndPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  if (!data || typeof data !== "object") return raw; // ya es plano (proxy / pruebas)

  const d = data as Record<string, any>;
  const dynVars = (d.conversation_initiation_client_data?.dynamic_variables ??
    d.metadata?.dynamic_variables ??
    d.dynamic_variables ??
    {}) as Record<string, unknown>;
  const transcriptRaw = Array.isArray(d.transcript) ? d.transcript : undefined;
  const transcript = transcriptRaw
    ?.map((t: any) => ({ role: String(t?.role ?? "unknown"), content: String(t?.message ?? t?.content ?? "") }))
    .filter((t: { content: string }) => t.content.length > 0);

  const normalized: Record<string, unknown> = {
    candidateId: obj.candidateId ?? dynVars.candidate_id ?? dynVars.candidateId,
    status: d.status ?? obj.status ?? "completed",
    summary: d.analysis?.transcript_summary ?? d.summary ?? obj.summary,
    durationSec: d.metadata?.call_duration_secs ?? d.call_duration_secs ?? obj.durationSec,
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

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();
  const existing = await repository.findCandidateById(payload.candidateId);
  if (!existing) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const outcome = outcomeFromStatus(payload.status);
  const result = await engine.recordCallOutcome({
    candidateId: payload.candidateId,
    outcome,
    summary: payload.summary,
    durationSec: payload.durationSec,
    negotiatedModelShare: payload.negotiatedModelShare,
    transcript: payload.transcript
  });

  return NextResponse.json({
    candidate: result.candidate,
    appliedTransitions: result.transitions,
    outcome
  });
}
