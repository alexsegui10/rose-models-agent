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
});
