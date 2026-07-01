import crypto from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/call/end/route";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

const SECRET = "test-webhook-secret";

// Construye una request como el post-call webhook NATIVO de ElevenLabs: firma HMAC (t=,v0=) sobre "ts.body".
function elevenLabsReq(body: unknown, secret: string, signature?: string) {
  const raw = JSON.stringify(body);
  const ts = "1700000000";
  const sig = signature ?? `t=${ts},v0=${crypto.createHmac("sha256", secret).update(`${ts}.${raw}`, "utf8").digest("hex")}`;
  return new Request("http://localhost/api/call/end", {
    method: "POST",
    headers: { "Content-Type": "application/json", "ElevenLabs-Signature": sig },
    body: raw
  });
}

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/call/end", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body)
  });
}

async function seedScheduled() {
  const repository = getSimulatorRepository();
  return repository.saveCandidate(
    normalizeCandidate({ ...createCandidate({ instagramUsername: `end_${Math.random()}` }), currentState: "CALL_SCHEDULED" })
  );
}

afterEach(() => {
  delete process.env.CALL_WEBHOOK_SECRET;
});

describe("webhook de fin de llamada", () => {
  it("sin CALL_WEBHOOK_SECRET -> 503", async () => {
    delete process.env.CALL_WEBHOOK_SECRET;
    const res = await POST(req({ candidateId: "x", status: "completed" }));
    expect(res.status).toBe(503);
  });

  it("token incorrecto -> 401", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const res = await POST(req({ candidateId: "x", status: "completed" }, "Bearer mal"));
    expect(res.status).toBe(401);
  });

  it("status 'completed' -> CALL_COMPLETED", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await POST(req({ candidateId: seeded.id, status: "completed", summary: "ok" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("COMPLETED");
    expect(json.candidate.currentState).toBe("CALL_COMPLETED");
  });

  it("status 'no-answer' -> CALL_NO_ANSWER", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const res = await POST(req({ candidateId: seeded.id, status: "no-answer" }, `Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
    expect(json.candidate.currentState).toBe("CALL_NO_ANSWER");
  });

  it("candidata inexistente -> 404", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const res = await POST(req({ candidateId: "no-existe", status: "completed" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(404);
  });

  it("buzon de voz: status completada pero la candidata no dijo nada -> NO_ANSWER (reintento, no contrato)", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const payload = {
      data: {
        status: "done",
        transcript: [
          { role: "agent", message: "Hola, soy Alex de Rose Models. Te aviso que grabo la llamada." },
          { role: "agent", message: "Pues mira, como veias por Instagram, es facil..." }
        ],
        conversation_initiation_client_data: { dynamic_variables: { candidate_id: seeded.id } }
      }
    };
    const res = await POST(elevenLabsReq(payload, SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("NO_ANSWER");
    expect(json.candidate.currentState).toBe("CALL_NO_ANSWER");
  });

  it("llamada real: status completada CON turnos de la candidata -> COMPLETED (no la trata como buzon)", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const payload = {
      data: {
        status: "done",
        transcript: [
          { role: "agent", message: "Hola, soy Alex de Rose Models." },
          { role: "user", message: "hola, si, cuentame" }
        ],
        conversation_initiation_client_data: { dynamic_variables: { candidate_id: seeded.id } }
      }
    };
    const res = await POST(elevenLabsReq(payload, SECRET));
    const json = await res.json();
    expect(json.outcome).toBe("COMPLETED");
    expect(json.candidate.currentState).toBe("CALL_COMPLETED");
  });
});

describe("webhook de fin: payload NATIVO de ElevenLabs (firma HMAC + body anidado)", () => {
  it("acepta firma HMAC + body anidado y resuelve el candidateId desde dynamic_variables", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const seeded = await seedScheduled();
    const payload = {
      type: "post_call_transcription",
      data: {
        status: "done",
        metadata: { call_duration_secs: 215 },
        analysis: { transcript_summary: "La candidata acepto y se agendo." },
        transcript: [
          { role: "agent", message: "Hola, soy del equipo de Rose Models." },
          { role: "user", message: "vale, me interesa" }
        ],
        conversation_initiation_client_data: { dynamic_variables: { candidate_id: seeded.id } }
      }
    };
    const res = await POST(elevenLabsReq(payload, SECRET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("COMPLETED");
    expect(json.candidate.currentState).toBe("CALL_COMPLETED");
  });

  it("firma HMAC invalida -> 401 (no registra nada)", async () => {
    process.env.CALL_WEBHOOK_SECRET = SECRET;
    const payload = {
      data: { status: "done", conversation_initiation_client_data: { dynamic_variables: { candidate_id: "x" } } }
    };
    const res = await POST(elevenLabsReq(payload, SECRET, "t=1700000000,v0=deadbeefdeadbeef"));
    expect(res.status).toBe(401);
  });
});
