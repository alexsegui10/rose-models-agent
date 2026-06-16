import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// "Ya le mandé la solicitud" (decision de Alex 16-jun): en cuentas privadas Alex manda la solicitud a
// mano (la API no deja); al marcarlo, la candidata sale del bucle de "aceptanos la solicitud" y pasa a
// revision de perfil. Solo aplica desde WAITING_PROFILE_ACCESS (idempotente en cualquier otro estado).
describe("markFollowRequestSent: 'Ya le mande la solicitud' desde el CRM", () => {
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
        ...createCandidate({ instagramUsername: "follow_case", profileVisibility: "PRIVATE" }),
        currentState
      })
    );
  }

  it("desde WAITING_PROFILE_ACCESS avanza a PROFILE_READY_FOR_REVIEW y deja constancia", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "WAITING_PROFILE_ACCESS");
    const result = await engine.markFollowRequestSent({ candidateId: seeded.id });
    expect(result.candidate.currentState).toBe("PROFILE_READY_FOR_REVIEW");
    expect(result.transitions).toHaveLength(1);
    expect(result.candidate.notes.some((note) => note.includes("FOLLOW_REQUEST_SENT_BY_ALEX"))).toBe(true);
  });

  it("es idempotente: desde otro estado no hace nada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");
    const result = await engine.markFollowRequestSent({ candidateId: seeded.id });
    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.transitions).toHaveLength(0);
  });
});
