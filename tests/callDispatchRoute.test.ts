import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";

// Mock de ElevenLabs para NO llamar de verdad: el spy registra si se intento la llamada saliente.
const h = vi.hoisted(() => ({
  isConfigured: true,
  startResult: { ok: true, conversationId: "conv-1" } as { ok: boolean; conversationId?: string; reason?: string },
  startSpy: vi.fn()
}));
vi.mock("@/infrastructure/integrations/elevenLabsOutbound", () => ({
  getElevenLabsOutboundConfig: () => ({
    isConfigured: h.isConfigured,
    apiKey: "k",
    agentId: "a",
    whatsappPhoneNumberId: "p",
    permissionTemplateName: "t",
    permissionTemplateLang: "es"
  }),
  startOutboundWhatsAppCall: async (...args: unknown[]) => {
    h.startSpy(...args);
    return h.startResult;
  }
}));

import { POST } from "@/app/api/call/dispatch/route";
import { getSimulatorRepository } from "@/server/simulatorStore";

const SECRET = "cron-secret-test";
const AT = 1_900_000_000_000;

function req(body: unknown, auth?: string) {
  return new Request("http://localhost/api/call/dispatch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body)
  });
}

async function seed(overrides: { currentState?: CandidateState; scheduledCallStartMs?: number; callAttempts?: number }) {
  const repository = getSimulatorRepository();
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `disp_${Math.random()}` }),
      currentState: overrides.currentState ?? "CALL_SCHEDULED",
      scheduledCallStartMs: overrides.scheduledCallStartMs ?? AT,
      callAttempts: overrides.callAttempts ?? 0
    })
  );
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  h.isConfigured = true;
  h.startResult = { ok: true, conversationId: "conv-1" };
  h.startSpy.mockClear();
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("auto-marcador /api/call/dispatch", () => {
  it("sin CRON_SECRET -> 500", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req({ candidateId: "x", scheduledForMs: AT }));
    expect(res.status).toBe(500);
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("bearer incorrecto -> 401, no llama", async () => {
    const res = await POST(req({ candidateId: "x", scheduledForMs: AT }, "Bearer mal"));
    expect(res.status).toBe(401);
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("cita firme (CALL_SCHEDULED + hora coincide + sin intentos) -> dispara la llamada", async () => {
    const c = await seed({ currentState: "CALL_SCHEDULED", scheduledCallStartMs: AT, callAttempts: 0 });
    const res = await POST(req({ candidateId: c.id, scheduledForMs: AT }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(h.startSpy).toHaveBeenCalledTimes(1);
  });

  it("ya NO esta en CALL_SCHEDULED (atendida/cerrada) -> NO llama", async () => {
    const c = await seed({ currentState: "CALL_COMPLETED", scheduledCallStartMs: AT });
    const res = await POST(req({ candidateId: c.id, scheduledForMs: AT }, `Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.skipped).toContain("state-");
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("reagendada a otra hora (no coincide scheduledForMs) -> NO llama", async () => {
    const c = await seed({ currentState: "CALL_SCHEDULED", scheduledCallStartMs: AT + 3_600_000 });
    const res = await POST(req({ candidateId: c.id, scheduledForMs: AT }, `Bearer ${SECRET}`));
    expect((await res.json()).skipped).toBe("rescheduled");
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("ya gasto los 3 intentos -> NO llama", async () => {
    const c = await seed({ currentState: "CALL_SCHEDULED", scheduledCallStartMs: AT, callAttempts: 3 });
    const res = await POST(req({ candidateId: c.id, scheduledForMs: AT }, `Bearer ${SECRET}`));
    expect((await res.json()).skipped).toBe("max-attempts");
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("ElevenLabs sin configurar -> no-op (200 skipped), NO llama", async () => {
    h.isConfigured = false;
    const c = await seed({ currentState: "CALL_SCHEDULED", scheduledCallStartMs: AT });
    const res = await POST(req({ candidateId: c.id, scheduledForMs: AT }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("elevenlabs-not-configured");
    expect(h.startSpy).not.toHaveBeenCalled();
  });
});
