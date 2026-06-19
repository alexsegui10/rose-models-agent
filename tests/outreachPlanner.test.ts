import { describe, expect, it } from "vitest";
import { createCandidate, normalizeCandidate, type Candidate, type ConversationMessage } from "@/domain/candidate";
import { planOutreach } from "@/application/outreachPlanner";

const HOUR = 60 * 60 * 1000;
const NOW = new Date("2026-06-19T12:00:00.000Z");

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "cand" }),
    ...overrides
  });
}

function agentMsg(content: string, ageMs: number, trigger?: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    candidateId: "cand",
    role: "agent",
    author: "AI_AGENT",
    content,
    createdAt: new Date(NOW.getTime() - ageMs),
    metadata: trigger ? { trigger } : undefined
  };
}

function candidateMsg(content: string, ageMs: number): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    candidateId: "cand",
    role: "candidate",
    author: "CANDIDATE",
    content,
    createdAt: new Date(NOW.getTime() - ageMs)
  };
}

describe("planOutreach — skips de seguridad (devuelve null)", () => {
  it("no toca estados terminales (CLOSED / REJECTED)", () => {
    for (const state of ["CLOSED", "REJECTED"] as const) {
      const c = candidate({ currentState: state, lastMessageAt: new Date(NOW.getTime() - 30 * HOUR) });
      const msgs = [agentMsg("hola, sigues ahi?", 30 * HOUR)];
      expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
    }
  });

  it("no toca si manualControlActive o automationPaused", () => {
    const base = { currentState: "QUALIFYING" as const, lastMessageAt: new Date(NOW.getTime() - 30 * HOUR) };
    const msgs = [agentMsg("sigues ahi?", 30 * HOUR)];
    expect(
      planOutreach({ candidate: candidate({ ...base, manualControlActive: true }), recentMessages: msgs, now: NOW })
    ).toBeNull();
    expect(
      planOutreach({ candidate: candidate({ ...base, automationPaused: true }), recentMessages: msgs, now: NOW })
    ).toBeNull();
  });

  it("no toca si en el historial hay una peticion de no-contacto", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 30 * HOUR) });
    const msgs = [candidateMsg("dejame en paz, no me escribas mas", 40 * HOUR), agentMsg("ok, lo siento", 30 * HOUR)];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });

  it("no toca si el ultimo mensaje del historial es de la candidata (ella ya contesto)", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 30 * HOUR) });
    const msgs = [agentMsg("y de donde eres?", 31 * HOUR), candidateMsg("de Madrid", 30 * HOUR)];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });

  it("no toca si todavia no esta idle (menos de ~20h)", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 10 * HOUR) });
    const msgs = [agentMsg("sigues ahi?", 10 * HOUR)];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });

  it("no toca un estado fuera del funnel activo (p.ej. WAITING_HUMAN_REVIEW / APPROVED / CALL_SCHEDULED)", () => {
    for (const state of ["WAITING_HUMAN_REVIEW", "APPROVED", "CALL_SCHEDULED", "CALL_COMPLETED"] as const) {
      const c = candidate({ currentState: state, lastMessageAt: new Date(NOW.getTime() - 30 * HOUR), callAttempts: 1 });
      const msgs = [agentMsg("hola", 30 * HOUR)];
      expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
    }
  });
});

describe("planOutreach — RESCHEDULE (3 llamadas sin respuesta)", () => {
  it("CALL_NO_ANSWER + callAttempts>=3 sin reagendar previo -> reschedule a COLLECTING_CALL_DETAILS", () => {
    const c = candidate({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(NOW.getTime() - 10 * HOUR)
    });
    const msgs = [agentMsg("te llamo en breve", 10 * HOUR)];
    const plan = planOutreach({ candidate: c, recentMessages: msgs, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan?.kind).toBe("reschedule");
    expect(plan?.transitionTo).toBe("COLLECTING_CALL_DETAILS");
    expect(plan?.markCold).toBeUndefined();
    expect(plan?.message.length).toBeGreaterThan(0);
    // Sin cifras ni claims de negocio.
    expect(plan?.message).not.toMatch(/\d+\s*%/);
  });

  it("reschedule dentro de la ventana de 24h -> sin etiqueta human_agent", () => {
    const c = candidate({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(NOW.getTime() - 12 * HOUR)
    });
    const plan = planOutreach({ candidate: c, recentMessages: [agentMsg("x", 12 * HOUR)], now: NOW });
    expect(plan?.humanAgentTag).toBe(false);
  });

  it("reschedule fuera de la ventana de 24h -> con etiqueta human_agent", () => {
    const c = candidate({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(NOW.getTime() - 30 * HOUR)
    });
    const plan = planOutreach({ candidate: c, recentMessages: [agentMsg("x", 30 * HOUR)], now: NOW });
    expect(plan?.humanAgentTag).toBe(true);
  });

  it("no reagenda dos veces (si ya hay un mensaje con trigger RESCHEDULE_CALL) -> null", () => {
    const c = candidate({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 3,
      lastMessageAt: new Date(NOW.getTime() - 30 * HOUR)
    });
    const msgs = [agentMsg("que dia te viene mejor?", 30 * HOUR, "RESCHEDULE_CALL")];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });

  it("CALL_NO_ANSWER con menos de 3 intentos NO reagenda por aqui (lo lleva el reintento de llamada)", () => {
    const c = candidate({
      currentState: "CALL_NO_ANSWER",
      callAttempts: 2,
      lastMessageAt: new Date(NOW.getTime() - 30 * HOUR)
    });
    expect(planOutreach({ candidate: c, recentMessages: [agentMsg("x", 30 * HOUR)], now: NOW })).toBeNull();
  });
});

describe("planOutreach — REENGAGE (silencio a mitad de funnel)", () => {
  const FUNNEL = [
    "NEW_LEAD",
    "QUALIFYING",
    "WAITING_PROFILE_ACCESS",
    "PROFILE_READY_FOR_REVIEW",
    "COLLECTING_CALL_DETAILS"
  ] as const;

  it("0 toques previos -> toque 1 de re-enganche en cada estado activo del funnel", () => {
    for (const state of FUNNEL) {
      const c = candidate({ currentState: state, lastMessageAt: new Date(NOW.getTime() - 22 * HOUR) });
      const msgs = [candidateMsg("vale", 30 * HOUR), agentMsg("genial, y de donde eres?", 22 * HOUR)];
      const plan = planOutreach({ candidate: c, recentMessages: msgs, now: NOW });
      expect(plan, `estado ${state}`).not.toBeNull();
      expect(plan?.kind).toBe("reengage");
      expect(plan?.markCold).toBeUndefined();
      expect(plan?.transitionTo).toBeUndefined();
      expect(plan?.message).not.toMatch(/\d+\s*%/);
    }
  });

  it("toque 1 dentro de 24h -> sin etiqueta; fuera de 24h -> con etiqueta", () => {
    const inWindow = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 22 * HOUR) });
    const planIn = planOutreach({ candidate: inWindow, recentMessages: [agentMsg("sigues ahi?", 22 * HOUR)], now: NOW });
    expect(planIn?.humanAgentTag).toBe(false);

    const outWindow = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 30 * HOUR) });
    const planOut = planOutreach({ candidate: outWindow, recentMessages: [agentMsg("sigues ahi?", 30 * HOUR)], now: NOW });
    expect(planOut?.humanAgentTag).toBe(true);
  });

  it("1 toque previo y >= ~24h desde ese toque -> toque 2 FINAL con markCold y etiqueta", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 26 * HOUR) });
    const msgs = [agentMsg("holaa, sigues interesada?", 26 * HOUR, "REENGAGE")];
    const plan = planOutreach({ candidate: c, recentMessages: msgs, now: NOW });
    expect(plan).not.toBeNull();
    expect(plan?.kind).toBe("reengage");
    expect(plan?.markCold).toBe(true);
    expect(plan?.humanAgentTag).toBe(true);
  });

  it("1 toque previo pero AUN no ha pasado ~24h desde ese toque -> null (no spamear)", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 10 * HOUR) });
    const msgs = [agentMsg("holaa, sigues interesada?", 10 * HOUR, "REENGAGE")];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });

  it("2 toques previos -> null (se deja en FRIO, sin tercer toque)", () => {
    const c = candidate({ currentState: "QUALIFYING", lastMessageAt: new Date(NOW.getTime() - 48 * HOUR) });
    const msgs = [
      agentMsg("holaa, sigues interesada?", 72 * HOUR, "REENGAGE"),
      agentMsg("te escribo por ultima vez", 48 * HOUR, "REENGAGE")
    ];
    expect(planOutreach({ candidate: c, recentMessages: msgs, now: NOW })).toBeNull();
  });
});
