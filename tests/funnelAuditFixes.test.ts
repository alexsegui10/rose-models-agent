import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

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

describe("Auditoria funnel: negacion de agencia se captura (no re-preguntar)", () => {
  for (const message of [
    "no, no he trabajado con agencias",
    "nunca trabaje con agencias",
    "no trabajo con ninguna agencia",
    "no he estado en ninguna agencia"
  ]) {
    it(`"${message}" marca worksWithAnotherAgency=false`, () => {
      const understanding = extractDeterministicUnderstanding(message, {
        lastAgentMessage: "Has trabajado con otras agencias?"
      });
      expect(understanding.extractedData.worksWithAnotherAgency).toBe(false);
    });
  }

  it("'trabajo con otra agencia' sigue marcando true", () => {
    const understanding = extractDeterministicUnderstanding("si, trabajo con otra agencia", {});
    expect(understanding.extractedData.worksWithAnotherAgency).toBe(true);
  });
});

describe("Auditoria funnel: una candidata RECHAZADA queda silenciada (sin respuesta ni gasto de OpenAI)", () => {
  it("no responde a una candidata ya rechazada por Alex", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "rejected_case", profileVisibility: "PUBLIC" }),
        age: 24,
        isAdultConfirmed: true,
        currentState: "WAITING_HUMAN_REVIEW"
      })
    );
    await engine.applyHumanDecision({ candidateId: seeded.id, decision: "REJECT" });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "rejected_case",
      message: "hola? sigues ahi?"
    });

    expect(result.candidate.currentState).toBe("REJECTED");
    // Decision de Alex: rechazada -> el bot deja de responder y no se gasta OpenAI.
    expect(result.response).toBe("");
    expect(result.understanding.actualProvider).toBe("deterministic");
  });
});
