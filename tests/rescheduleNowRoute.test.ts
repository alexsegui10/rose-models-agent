import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/call/reschedule-now/route";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

/**
 * REAGENDADO INSTANTANEO por Instagram: cuando una llamada agota los 3 intentos sin respuesta, en vez de
 * esperar al cron diario, el webhook de fin encola (via QStash, delay corto) una llamada a este endpoint,
 * que reagenda AL INSTANTE por IG SOLO a la candidata del id (sin barrer, sin filtro de inactividad de 20h).
 *
 * Mirror del harness de cronOutreachRoute.test.ts: repo in-memory + fetch mockeado (provider real de IG).
 */

const SECRET = "test-cron-secret";
const HOUR = 60 * 60 * 1000;

function req(candidateId: string, auth?: string) {
  return new Request("http://localhost/api/call/reschedule-now", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify({ candidateId })
  });
}

async function seed(overrides: Partial<Candidate>) {
  const repository = getSimulatorRepository();
  return repository.saveCandidate(
    normalizeCandidate({ ...createCandidate({ instagramUsername: `resnow_${Math.random()}` }), ...overrides })
  );
}

// Instagram configurado para que el envio se intente (provider real con fetch mockeado por env).
function configureInstagram() {
  process.env.INSTAGRAM_VERIFY_TOKEN = "vt";
  process.env.INSTAGRAM_APP_SECRET = "as";
  process.env.INSTAGRAM_ACCESS_TOKEN = "token";
}

const originalFetch = global.fetch;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.INSTAGRAM_VERIFY_TOKEN;
  delete process.env.INSTAGRAM_APP_SECRET;
  delete process.env.INSTAGRAM_ACCESS_TOKEN;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("reschedule-now — auth", () => {
  it("sin CRON_SECRET configurado -> 503", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req("x", `Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it("token incorrecto -> 401", async () => {
    const res = await POST(req("x", "Bearer mal"));
    expect(res.status).toBe(401);
  });

  it("sin body/candidateId -> 400", async () => {
    const bad = new Request("http://localhost/api/call/reschedule-now", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({})
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });

  it("sin Instagram configurado -> no-op (200, no envia)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });
    const res = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await res.json()).skipped).toBe("instagram-not-configured");
  });
});

describe("reschedule-now — acciones", () => {
  it("reagenda una candidata elegible (CALL_NO_ANSWER + 3 intentos): envia UN mensaje por IG (trigger RESCHEDULE_CALL) y pasa a COLLECTING_CALL_DETAILS", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });

    const res = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("rescheduled");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const updated = await repository.findCandidateById(seeded.id);
    expect(updated?.currentState).toBe("COLLECTING_CALL_DETAILS");
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.metadata?.trigger === "RESCHEDULE_CALL")).toBe(true);
    const rescheduleMsg = messages.find((m) => m.metadata?.trigger === "RESCHEDULE_CALL");
    expect(rescheduleMsg?.metadata?.provider).toBe("deterministic");
    expect(rescheduleMsg?.metadata?.proactive).toBe(true);
    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.some((t) => t.toState === "COLLECTING_CALL_DETAILS")).toBe(true);
  });

  it("fuera de 24h -> etiqueta human_agent (MESSAGE_TAG / HUMAN_AGENT)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });
    await POST(req(seeded.id, `Bearer ${SECRET}`));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messaging_type).toBe("MESSAGE_TAG");
    expect(body.tag).toBe("HUMAN_AGENT");
  });

  it("dentro de 24h -> messaging_type RESPONSE (sin etiqueta)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 2 * HOUR)
    });
    await POST(req(seeded.id, `Bearer ${SECRET}`));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.tag).toBeUndefined();
  });

  it("IDEMPOTENTE: dos llamadas seguidas -> el 2o disparo ve el trigger RESCHEDULE_CALL y NO reagenda otra vez (fetch 1 sola vez)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    // lastMessageAt reciente (< 20h): reagenda al instante (independiente de la ventana de re-enganche) y el
    // 2o disparo no puede caer en un toque de re-enganche (que solo aplica con >20h de inactividad).
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 2 * HOUR)
    });

    const first = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect((await first.json()).result).toBe("rescheduled");
    const second = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect((await second.json()).result).toBe("skipped");

    // No se reagenda dos veces: un solo envio y un solo mensaje con trigger RESCHEDULE_CALL.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const messages = await repository.listMessages(seeded.id);
    expect(messages.filter((m) => m.metadata?.trigger === "RESCHEDULE_CALL")).toHaveLength(1);
    const updated = await repository.findCandidateById(seeded.id);
    expect(updated?.currentState).toBe("COLLECTING_CALL_DETAILS");
  });

  it("respeta la PAUSA de Alex: manualControlActive=true -> no envia, sigue CALL_NO_ANSWER", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      manualControlActive: true,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });

    const res = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect((await res.json()).result).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
    const updated = await repository.findCandidateById(seeded.id);
    expect(updated?.currentState).toBe("CALL_NO_ANSWER");
  });

  it("no elegible (callAttempts < 3) -> no envia (skipped)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 2,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });

    const res = await POST(req(seeded.id, `Bearer ${SECRET}`));
    expect((await res.json()).result).toBe("skipped");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("candidata inexistente -> 200 skipped not-found (no barre nada)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await POST(req("no-existe", `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect((await res.json()).skipped).toBe("not-found");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
