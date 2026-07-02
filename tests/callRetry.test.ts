import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

async function seed(repository: InMemoryCandidateRepository, state: CandidateState, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `retry_${Math.random()}` }),
      currentState: state,
      ...overrides
    })
  );
}

describe("noteCallAttempt: contador de intentos (incrementa AL DISPARAR la llamada)", () => {
  it("incrementa callAttempts y lo persiste", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 0 });

    const after = await engine.noteCallAttempt(seeded.id);
    expect(after.candidate.callAttempts).toBe(1);

    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.callAttempts).toBe(1);
  });

  it("incrementa acumulativamente en disparos sucesivos", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1 });
    await engine.noteCallAttempt(seeded.id);
    const after = await engine.noteCallAttempt(seeded.id);
    expect(after.candidate.callAttempts).toBe(3);
  });

  it("P1-2: reintento desde CALL_NO_ANSWER se re-arma y el resultado SI se registra (sin resetear intentos)", async () => {
    const { engine, repository } = createEngine();
    // Primer intento ya fallido: en CALL_NO_ANSWER con 1 intento usado.
    const seeded = await seed(repository, "CALL_NO_ANSWER", { callAttempts: 1 });

    // Alex vuelve a llamar -> re-arma (NO_ANSWER->SCHEDULED) y desde jul-2026 queda EN CURSO (anti doble-llamada).
    const after = await engine.noteCallAttempt(seeded.id);
    expect(after.candidate.currentState).toBe("CALL_IN_PROGRESS");
    expect(after.candidate.callAttempts).toBe(2);

    // Esta vez SI contesta: el COMPLETED del reintento ya NO se pierde (antes se descartaba desde CALL_NO_ANSWER).
    const outcome = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "COMPLETED" });
    expect(outcome.candidate.currentState).toBe("CALL_COMPLETED");
  });

  // jul-2026 (hallazgo agenda-02): al disparar, la candidata queda CALL_IN_PROGRESS -> una SEGUNDA entrega
  // del auto-marcador (o el boton manual tras el dispatch) ve un estado no-agendado y NO vuelve a marcar.
  it("anti doble-llamada: tras disparar queda CALL_IN_PROGRESS (un segundo disparo del slot no llama)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 0 });
    const after = await engine.noteCallAttempt(seeded.id);
    expect(after.candidate.currentState).toBe("CALL_IN_PROGRESS");
    expect(after.candidate.callAttempts).toBe(1);
    // El resultado se registra igual desde EN CURSO.
    const outcome = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(outcome.candidate.currentState).toBe("CALL_NO_ANSWER");
  });
});

describe("recordCallOutcome NO_ANSWER: reintento diferido", () => {
  it("con 1 intento usado -> shouldRetryCall true, attemptsUsed 1", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1 });
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(result.candidate.currentState).toBe("CALL_NO_ANSWER");
    expect(result.shouldRetryCall).toBe(true);
    expect(result.attemptsUsed).toBe(1);
  });

  it("reintento: reprograma scheduledCallStartMs +30min y lo devuelve (re-arma el auto-marcador)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1 });
    const nowMs = 1_900_000_000_000;
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER", nowMs });
    expect(result.shouldRetryCall).toBe(true);
    expect(result.retryScheduledForMs).toBe(nowMs + 30 * 60 * 1000);
    expect(result.candidate.scheduledCallStartMs).toBe(nowMs + 30 * 60 * 1000);
    expect(result.candidate.currentState).toBe("CALL_NO_ANSWER");
    expect(result.candidate.notes.some((note) => note.toLowerCase().includes("reintento"))).toBe(true);
  });

  it("sin reintento (3 intentos): no reprograma la hora ni devuelve retryScheduledForMs", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 3, scheduledCallStartMs: 111 });
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER", nowMs: 1_900_000_000_000 });
    expect(result.shouldRetryCall).toBe(false);
    expect(result.retryScheduledForMs).toBeUndefined();
    expect(result.candidate.scheduledCallStartMs).toBe(111);
  });

  it("con 3 intentos usados -> shouldRetryCall false y deja nota de seguimiento humano", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 3 });
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(result.shouldRetryCall).toBe(false);
    expect(result.attemptsUsed).toBe(3);
    expect(result.candidate.notes.some((note) => note.includes("CALL_FOLLOWUP") || note.includes("seguimiento"))).toBe(true);
  });

  it("recordCallOutcome NO incrementa el contador (solo lo lee)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 2 });
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(result.candidate.callAttempts).toBe(2);
    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.callAttempts).toBe(2);
  });

  it("COMPLETED no marca reintento", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1 });
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "COMPLETED" });
    expect(result.candidate.currentState).toBe("CALL_COMPLETED");
    expect(result.shouldRetryCall).toBeFalsy();
  });

  // jul-2026 (voz-05 + BLOQUEANTE del revisor): reproduce el camino REAL del dispatch — al re-marcar, el
  // dispatch pasa el conversationId del NUEVO intento a noteCallAttempt (pisa lastCallConversationId). El
  // webhook REAL del reintento DEBE registrarse (antes se descartaba por anclar la idempotencia ahí), y un
  // duplicado del intento ANTERIOR (ya registrado) SÍ se ignora.
  it("BLOQUEANTE: el webhook real del REINTENTO se registra; el duplicado del intento anterior se ignora", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1, lastCallConversationId: "conv-1" });
    // Intento 1 no contesta (conv-1): outcome registrado -> reintento armado.
    await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER", conversationId: "conv-1" });
    // Duplicado rezagado del intento 1 (conv-1, ya registrado): se ignora.
    const dup = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER", conversationId: "conv-1" });
    expect(dup.transitions).toHaveLength(0);
    // El reintento DISPARA con el conversationId del intento 2 (como hace el dispatch real): CALL_IN_PROGRESS.
    await engine.noteCallAttempt(seeded.id, "conv-2");
    // El webhook REAL del intento 2 (conv-2) DEBE registrarse (antes se perdia por anclar al campo pisado).
    const real = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "COMPLETED", conversationId: "conv-2" });
    expect(real.transitions.length).toBeGreaterThan(0);
    expect(real.candidate.currentState).toBe("CALL_COMPLETED");
  });

  // El mismo BLOQUEANTE aplicado al invariante 2: una MENOR declarada en el REINTENTO debe CERRAR.
  it("BLOQUEANTE + invariante 2: menor declarada en el REINTENTO -> CLOSED (no se pierde el cierre)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", { callAttempts: 1, lastCallConversationId: "conv-1" });
    await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER", conversationId: "conv-1" });
    await engine.noteCallAttempt(seeded.id, "conv-2");
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      conversationId: "conv-2",
      transcriptFacts: { underage: true, handedOff: false }
    });
    expect(result.candidate.currentState).toBe("CLOSED");
  });
});
