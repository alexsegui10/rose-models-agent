import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// recordCallOutcome: lo llama el webhook de fin de llamada. COMPLETED -> CALL_COMPLETED (Alex retoma:
// enviar contrato); NO_ANSWER -> CALL_NO_ANSWER. Solo desde CALL_SCHEDULED/CALL_IN_PROGRESS.
describe("recordCallOutcome: resultado de la llamada de voz", () => {
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

  async function seed(repository: InMemoryCandidateRepository, currentState: CandidateState) {
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "call_case" }),
        currentState
      })
    );
  }

  it("COMPLETED desde CALL_SCHEDULED -> CALL_COMPLETED y deja resumen en notas", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED");
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      summary: "Explicado todo, le paso el contrato"
    });
    expect(result.candidate.currentState).toBe("CALL_COMPLETED");
    expect(result.transitions).toHaveLength(1);
    expect(result.candidate.notes.some((note) => note.includes("CALL_COMPLETED"))).toBe(true);
  });

  it("NO_ANSWER desde CALL_IN_PROGRESS -> CALL_NO_ANSWER", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_IN_PROGRESS");
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(result.candidate.currentState).toBe("CALL_NO_ANSWER");
    expect(result.transitions).toHaveLength(1);
  });

  it("es idempotente: desde un estado fuera de la llamada no hace nada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "COMPLETED" });
    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.transitions).toHaveLength(0);
  });
});
