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

  it("guarda lastCall con duracion, % negociado, resumen y transcripcion", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED");
    const result = await engine.recordCallOutcome({
      candidateId: seeded.id,
      outcome: "COMPLETED",
      summary: "Negociamos al 65, acepta",
      durationSec: 312,
      negotiatedModelShare: 65,
      transcript: [
        { role: "agent", content: "Hola, te llamo de Rose Models" },
        { role: "candidate", content: "Vale, cuentame" }
      ]
    });
    expect(result.candidate.lastCall).toBeDefined();
    expect(result.candidate.lastCall?.result).toBe("COMPLETED");
    expect(result.candidate.lastCall?.durationSec).toBe(312);
    expect(result.candidate.lastCall?.negotiatedModelShare).toBe(65);
    expect(result.candidate.lastCall?.summary).toBe("Negociamos al 65, acepta");
    expect(result.candidate.lastCall?.transcript).toHaveLength(2);
    expect(result.candidate.lastCall?.endedAt).toBeTruthy();
    // Se persiste (sobrevive a la normalizacion de lectura).
    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.lastCall?.negotiatedModelShare).toBe(65);
  });

  it("NO_ANSWER deja lastCall con result NO_ANSWER (sin inventar duracion/% )", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED");
    const result = await engine.recordCallOutcome({ candidateId: seeded.id, outcome: "NO_ANSWER" });
    expect(result.candidate.lastCall?.result).toBe("NO_ANSWER");
    expect(result.candidate.lastCall?.durationSec).toBeUndefined();
    expect(result.candidate.lastCall?.negotiatedModelShare).toBeUndefined();
    expect(result.candidate.lastCall?.transcript).toEqual([]);
  });
});
