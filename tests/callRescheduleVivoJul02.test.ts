import { describe, expect, it } from "vitest";
import { analyzeCallTranscript } from "@/application/callTranscriptAnalysis";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { canTransition } from "@/domain/stateMachine";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// REAGENDAR VIVO (jul-2026, decisión de Alex): "ahora no puedo" NADA MÁS descolgar -> el bot cierra con
// "te escribo por Instagram y lo movemos", el webhook reabre el agendado (COLLECTING_CALL_DETAILS), el bot
// de IG despierta SOLO para reagendar (mensaje proactivo) y al agendar la nueva hora se re-silencia solo.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
  return { engine, repository };
}

describe("director: 'ahora no puedo' nada más descolgar -> CLOSE_RESCHEDULE (no contrato)", () => {
  it("sin ninguna etapa cubierta -> CLOSE_RESCHEDULE con texto de reagendar por Instagram", () => {
    const afterOpen = { ...initialCallDirectorState(), disclosureGiven: true };
    const decision = decideCallDirective({ state: afterOpen, signal: "wants-to-end" });
    expect(decision.directive.type).toBe("CLOSE_RESCHEDULE");
    const plan = planCallUtterance({ directive: decision.directive });
    expect(plan.deterministicText?.toLowerCase()).toContain("instagram");
    expect(plan.deterministicText?.toLowerCase()).not.toContain("contrato");
  });

  it("con el pitch YA avanzado -> cierre con contrato de siempre", () => {
    const midCall = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS" as const, "HER_RESPONSIBILITIES" as const]
    };
    const decision = decideCallDirective({ state: midCall, signal: "wants-to-end" });
    expect(decision.directive.type).toBe("CLOSE_WITH_CONTRACT");
  });
});

describe("análisis del transcript: detecta el cierre de reagendado", () => {
  it("'ahora no puedo, me pillas fatal' al descolgar -> rescheduleRequested", () => {
    const facts = analyzeCallTranscript([
      { role: "agent", content: "Hola, soy Alex, de Rose Models. ¿Te cuento cómo trabajamos?" },
      { role: "user", content: "uf ahora no puedo, me pillas fatal" },
      { role: "agent", content: "Tranquila, te escribo por Instagram y lo movemos." }
    ]);
    expect(facts.rescheduleRequested).toBe(true);
    expect(facts.underage).toBe(false);
    expect(facts.handedOff).toBe(false);
  });

  it("una llamada normal completa NO marca reagendado", () => {
    const facts = analyzeCallTranscript([
      { role: "agent", content: "Hola, soy Alex." },
      { role: "user", content: "hola sí, cuéntame" },
      { role: "user", content: "vale, me parece bien" }
    ]);
    expect(facts.rescheduleRequested).toBeFalsy();
  });
});

describe("motor + grafo: el webhook reabre el agendado y el ciclo se re-silencia solo", () => {
  it("el grafo permite CALL_IN_PROGRESS -> COLLECTING_CALL_DETAILS", () => {
    expect(canTransition("CALL_IN_PROGRESS", "COLLECTING_CALL_DETAILS")).toBe(true);
    expect(canTransition("CALL_SCHEDULED", "COLLECTING_CALL_DETAILS")).toBe(true);
  });

  it("recordCallOutcome con rescheduleRequested -> COLLECTING, hora desarmada y mensaje proactivo persistido", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "resched_1" }),
        currentState: "CALL_IN_PROGRESS",
        firstName: "Carla",
        age: 24,
        isAdultConfirmed: true,
        phone: "+5491155554444",
        scheduledCallStartMs: Date.now() - 60_000,
        scheduledCallSlot: "hoy a las 18h",
        callAttempts: 1
      })
    );
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      conversationId: "conv-r1",
      transcriptFacts: { underage: false, handedOff: false, rescheduleRequested: true, coveredStages: [], closedWithContract: false, deferredQuestions: 0, candidateTurns: 3 }
    });
    expect(result.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(result.candidate.scheduledCallStartMs).toBeUndefined();
    expect(result.candidate.scheduledCallSlot).toBeUndefined();
    expect(result.followUpMessage).toContain("día y hora");
    // El mensaje proactivo quedó en el historial (el CRM lo ve; la ruta lo envía por IG).
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.role === "agent" && m.content.includes("mal momento"))).toBe(true);
    // Y no se arma reintento de llamada (no es un NO_ANSWER).
    expect(result.shouldRetryCall).toBeFalsy();
  });

  it("respeta la PAUSA de Alex: candidata pausada -> reabre COLLECTING pero SIN mensaje automático (nota para Alex)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "resched_pausada" }),
        currentState: "CALL_IN_PROGRESS",
        manualControlActive: true,
        callAttempts: 1
      })
    );
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      conversationId: "conv-rp",
      transcriptFacts: { underage: false, handedOff: false, rescheduleRequested: true, coveredStages: [], closedWithContract: false, deferredQuestions: 0, candidateTurns: 3 }
    });
    expect(result.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(result.followUpMessage).toBeUndefined();
    expect(result.candidate.notes.join(" ")).toContain("REAGENDAR PENDIENTE");
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.role === "agent" && m.content.includes("mal momento"))).toBe(false);
  });

  it("ADVERSARIAL invariante 2: menor + 'ahora no puedo' -> CLOSED gana al reagendado", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "resched_menor" }),
        currentState: "CALL_IN_PROGRESS",
        callAttempts: 1
      })
    );
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      conversationId: "conv-r2",
      transcriptFacts: { underage: true, handedOff: false, rescheduleRequested: true, coveredStages: [], closedWithContract: false, deferredQuestions: 0, candidateTurns: 3 }
    });
    expect(result.candidate.currentState).toBe("CLOSED");
    expect(result.followUpMessage).toBeUndefined();
  });

  it("ciclo completo: tras reabrir, la candidata da nueva hora -> se agenda y se re-silencia solo", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "resched_ciclo" }),
        currentState: "CALL_IN_PROGRESS",
        firstName: "Carla",
        age: 24,
        isAdultConfirmed: true,
        humanFitDecision: "APPROVED",
        phone: "+5491155554444",
        scheduledCallStartMs: Date.now() - 60_000,
        callAttempts: 1
      })
    );
    await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      conversationId: "conv-r3",
      transcriptFacts: { underage: false, handedOff: false, rescheduleRequested: true, coveredStages: [], closedWithContract: false, deferredQuestions: 0, candidateTurns: 3 }
    });

    // Ella contesta al proactivo con una hora nueva -> el bot agenda (auto-agendado determinista).
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "resched_ciclo",
      message: "uy perdón! mañana a las 6 de la tarde me viene genial"
    });
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(reply.candidate.scheduledCallStartMs).toBeGreaterThan(Date.now());

    // Y con la llamada re-agendada, el bot vuelve a estar silenciado para charla neutra.
    const silent = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "resched_ciclo",
      message: "genial jaja"
    });
    expect(silent.response).toBe("");
  });
});
