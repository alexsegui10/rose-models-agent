import { describe, expect, it, vi, afterEach } from "vitest";
import { buildSpanishCallSummary } from "@/application/callSummary";
import { analyzeCallTranscript } from "@/application/callTranscriptAnalysis";
import { startOutboundSipCall, getElevenLabsOutboundConfig } from "@/infrastructure/integrations/elevenLabsOutbound";
import { POST as endPOST } from "@/app/api/call/end/route";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// LOTE 1 (3-jul, tras la llamada real de Alex): (a) la EVIDENCIA manda sobre la etiqueta — ElevenLabs
// marcó "failed" una llamada completa de 2:59 y el falso NO CONTESTA disparó una RE-LLAMADA indebida;
// (b) un timeout del dial es "resultado desconocido", no "no salió" (le sonó el teléfono "por la cara"
// mientras el sistema avisaba de error); (c) el resumen del CRM en ESPAÑOL y determinista.

const SECRET = "test-webhook-secret";

function endReq(body: unknown) {
  return new Request("http://localhost/api/call/end", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body)
  });
}

// Transcript realista de la llamada completa de hoy (2:59, cierre con contrato, dos dudas deferidas).
const FULL_TRANSCRIPT = [
  { role: "agent", content: "Hola Ana, soy Alex, el de Rose Models..." },
  { role: "user", content: "vale, contame" },
  { role: "agent", content: "nosotros nos encargamos de la parte operativa..." },
  { role: "user", content: "dale" },
  { role: "agent", content: "tu parte sería crear contenido..." },
  { role: "user", content: "vale" },
  { role: "agent", content: "arrancamos con cinco días de contenido..." },
  { role: "user", content: "si" },
  { role: "agent", content: "el reparto es un 30% para ti y un 70% para la agencia... cobras cada 14 dias" },
  { role: "user", content: "¿y los impuestos como van alla en argentina?" },
  { role: "agent", content: "eso te lo confirmo por WhatsApp..." },
  { role: "user", content: "vale" },
  { role: "agent", content: "¿algún límite que debamos tener en cuenta?" },
  { role: "user", content: "vale, dale" },
  { role: "agent", content: "te paso el contrato, unas guías..." },
  { role: "user", content: "perfecto, adios" }
];

afterEach(() => {
  delete process.env.CALL_WEBHOOK_SECRET;
  vi.restoreAllMocks();
});

describe("1a: la evidencia manda sobre la etiqueta del status", () => {
  async function seedScheduled() {
    const repository = getSimulatorRepository();
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `evi_${Math.random()}` }),
        currentState: "CALL_SCHEDULED",
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true
      })
    );
  }

  it("status 'failed' + conversación real (turnos + 179s) -> COMPLETED, sin reintento", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await endPOST(
      endReq({ candidateId: seeded.id, status: "failed", durationSec: 179, transcript: FULL_TRANSCRIPT })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("COMPLETED");
    const after = await getSimulatorRepository().findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CALL_COMPLETED");
    expect(after?.lastCall?.result).toBe("COMPLETED");
  });

  it("status 'failed' CORTA y sin conversación (12s, sin turnos de ella) -> sigue NO_ANSWER", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await endPOST(
      endReq({
        candidateId: seeded.id,
        status: "failed",
        durationSec: 12,
        transcript: [{ role: "agent", content: "Hola, soy Alex..." }]
      })
    );
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
  });

  it("el BUZÓN sigue siendo NO_ANSWER (status completed, cero turnos de ella)", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await endPOST(
      endReq({
        candidateId: seeded.id,
        status: "done",
        durationSec: 95,
        transcript: [{ role: "agent", content: "Hola, soy Alex... deja tu mensaje" }]
      })
    );
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
  });

  it("los turnos de RUIDO ('...') no cuentan como evidencia: llamada muerta con ASR ruidoso -> NO_ANSWER", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await endPOST(
      endReq({
        candidateId: seeded.id,
        status: "failed",
        durationSec: 95,
        transcript: [
          { role: "agent", content: "Hola, soy Alex..." },
          { role: "user", content: "..." },
          { role: "agent", content: "¿Me lo puedes repetir?" },
          { role: "user", content: "…" },
          { role: "agent", content: "te paso con mi socio..." },
          { role: "user", content: "..." }
        ]
      })
    );
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
  });

  it("sin duración (desconocida) NO se anula la etiqueta (conservador)", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await endPOST(endReq({ candidateId: seeded.id, status: "failed", transcript: FULL_TRANSCRIPT }));
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
  });
});

describe("1c: resumen del CRM en español, determinista, desde el replay", () => {
  it("la llamada real de hoy produce un resumen en español con temas, reparto, cierre y dudas", () => {
    const facts = analyzeCallTranscript(FULL_TRANSCRIPT);
    const summary = buildSpanishCallSummary({ outcome: "COMPLETED", durationSec: 179, facts });
    expect(summary).toContain("2 min 59 s");
    expect(summary).toContain("Se explicó:");
    expect(summary).toContain("70/30");
    expect(summary).toContain("contrato");
    expect(summary).toMatch(/duda(s)? qued(ó|aron) pendiente/);
    // Nada de inglés.
    expect(summary.toLowerCase()).not.toMatch(/\b(the|call|revenue|split)\b/);
  });

  it("no contestó / buzón -> resumen corto honesto", () => {
    const facts = analyzeCallTranscript([{ role: "agent", content: "hola..." }]);
    const summary = buildSpanishCallSummary({ outcome: "NO_ANSWER", durationSec: 20, facts });
    expect(summary).toContain("No contestó");
  });

  it("menor declarada -> el resumen lo dice y no añade negocio", () => {
    const facts = analyzeCallTranscript([
      { role: "agent", content: "hola..." },
      { role: "user", content: "tengo 17" }
    ]);
    const summary = buildSpanishCallSummary({ outcome: "COMPLETED", durationSec: 40, facts });
    expect(summary).toContain("MENOR");
    expect(summary).not.toContain("contrato");
  });

  it("el webhook guarda el resumen ESPAÑOL aunque ElevenLabs mande el suyo en inglés", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const repository = getSimulatorRepository();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `sum_${Math.random()}` }),
        currentState: "CALL_SCHEDULED"
      })
    );
    const res = await endPOST(
      endReq({
        candidateId: seeded.id,
        status: "done",
        durationSec: 179,
        summary: "The conversation is a follow-up call between Alex and Ana...",
        transcript: FULL_TRANSCRIPT
      })
    );
    expect(res.status).toBe(200);
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.lastCall?.summary).toContain("Se explicó:");
    expect(after?.lastCall?.summary).not.toContain("follow-up call");
  });
});

describe("1b: timeout del dial = resultado desconocido (indeterminate)", () => {
  it("un fetch que lanza TimeoutError devuelve ok:false + indeterminate:true", async () => {
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "dial_timeout" }),
      phone: "+5491155550000"
    });
    const config = { isConfigured: true, apiKey: "k", agentId: "a", agentPhoneNumberId: "p" };
    const fetchImpl = (async () => {
      const err = new Error("timeout");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;
    const result = await startOutboundSipCall(candidate, config, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBe(true);
  });

  it("un rechazo LIMPIO de ElevenLabs (4xx) NO es indeterminado (la llamada seguro no salió)", async () => {
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "dial_clean_fail" }),
      phone: "+5491155550000"
    });
    const config = { isConfigured: true, apiKey: "k", agentId: "a", agentPhoneNumberId: "p" };
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ detail: "bad request" }), { status: 400 })) as unknown as typeof fetch;
    const result = await startOutboundSipCall(candidate, config, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBeFalsy();
  });

  it("config presente pero sin teléfono -> fallo limpio, no indeterminado", async () => {
    const candidate = normalizeCandidate({ ...createCandidate({ instagramUsername: "dial_no_phone" }) });
    const config = getElevenLabsOutboundConfig({
      ELEVENLABS_API_KEY: "k",
      ELEVENLABS_AGENT_ID: "a",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "p"
    } as unknown as NodeJS.ProcessEnv);
    const result = await startOutboundSipCall(candidate, config);
    expect(result.ok).toBe(false);
    expect(result.indeterminate).toBeFalsy();
  });
});
