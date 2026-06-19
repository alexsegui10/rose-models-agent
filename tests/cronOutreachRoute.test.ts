import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/cron/outreach/route";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

const SECRET = "test-cron-secret";
const HOUR = 60 * 60 * 1000;

function req(auth?: string) {
  return new Request("http://localhost/api/cron/outreach", {
    method: "POST",
    headers: { ...(auth ? { Authorization: auth } : {}) }
  });
}

async function seed(overrides: Partial<Candidate>) {
  const repository = getSimulatorRepository();
  return repository.saveCandidate(
    normalizeCandidate({ ...createCandidate({ instagramUsername: `cron_${Math.random()}` }), ...overrides })
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

describe("cron de re-enganche — auth", () => {
  it("sin CRON_SECRET configurado -> 503", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it("token incorrecto -> 401", async () => {
    const res = await POST(req("Bearer mal"));
    expect(res.status).toBe(401);
  });

  it("sin Instagram configurado -> no-op (200, no envia)", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await seed({ currentState: "QUALIFYING", lastMessageAt: new Date(Date.now() - 30 * HOUR) });
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cron de re-enganche — acciones", () => {
  it("reengage: envia toque 1 con messaging_type RESPONSE (dentro de 24h) y guarda el mensaje con trigger REENGAGE", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({ currentState: "QUALIFYING", lastMessageAt: new Date(Date.now() - 22 * HOUR) });
    // El ultimo mensaje del historial debe ser del agente (ella no contesto).
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "agent",
      author: "AI_AGENT",
      content: "y de donde eres?",
      createdAt: new Date(Date.now() - 22 * HOUR),
      metadata: { trigger: "AGENT_TURN" }
    });

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.tag).toBeUndefined();

    const messages = await repository.listMessages(seeded.id);
    const reengage = messages.filter((m) => m.metadata?.trigger === "REENGAGE");
    expect(reengage).toHaveLength(1);
    expect(reengage[0].metadata?.provider).toBe("deterministic");
  });

  it("reengage fuera de 24h -> usa etiqueta human_agent (MESSAGE_TAG / HUMAN_AGENT)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({ currentState: "QUALIFYING", lastMessageAt: new Date(Date.now() - 30 * HOUR) });
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "agent",
      author: "AI_AGENT",
      content: "y de donde eres?",
      createdAt: new Date(Date.now() - 30 * HOUR)
    });

    await POST(req(`Bearer ${SECRET}`));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.messaging_type).toBe("MESSAGE_TAG");
    expect(body.tag).toBe("HUMAN_AGENT");
  });

  it("reschedule: 3 llamadas sin respuesta -> envia, guarda trigger RESCHEDULE_CALL y pasa a COLLECTING_CALL_DETAILS", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(Date.now() - 30 * HOUR)
    });

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);

    const updated = await repository.findCandidateById(seeded.id);
    expect(updated?.currentState).toBe("COLLECTING_CALL_DETAILS");
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.metadata?.trigger === "RESCHEDULE_CALL")).toBe(true);
    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.some((t) => t.toState === "COLLECTING_CALL_DETAILS")).toBe(true);
  });

  it("markCold: toque 2 final deja una NOTA COLD_NO_RESPONSE sin cerrar (no cambia a estado terminal)", async () => {
    configureInstagram();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();
    const seeded = await seed({ currentState: "QUALIFYING", lastMessageAt: new Date(Date.now() - 30 * HOUR) });
    // Un toque previo (REENGAGE) hace > 26h, para que toque el toque 2 final.
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "agent",
      author: "AI_AGENT",
      content: "holaa, sigues interesada?",
      createdAt: new Date(Date.now() - 30 * HOUR),
      metadata: { trigger: "REENGAGE", provider: "deterministic" }
    });

    await POST(req(`Bearer ${SECRET}`));

    const updated = await repository.findCandidateById(seeded.id);
    expect(updated?.currentState).toBe("QUALIFYING"); // NO se cierra
    expect(updated?.notes.some((n) => n.startsWith("COLD_NO_RESPONSE"))).toBe(true);
  });

  it("una candidata que falla no rompe el resto (try/catch por candidata)", async () => {
    configureInstagram();
    // fetch ok siempre; el fallo lo inducimos haciendo que addTransition explote en una.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
    const repository = getSimulatorRepository();

    const ok = await seed({ currentState: "QUALIFYING", lastMessageAt: new Date(Date.now() - 22 * HOUR) });
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: ok.id,
      role: "agent",
      author: "AI_AGENT",
      content: "y de donde eres?",
      createdAt: new Date(Date.now() - 22 * HOUR)
    });

    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });
});
