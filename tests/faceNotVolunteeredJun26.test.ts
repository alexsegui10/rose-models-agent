import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ModelConversationOutputSchema, type ConversationUnderstandingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug Alex 26-jun: "que movil hace falta" -> el bot recitaba la politica de la CARA. CAUSA: el boost de la IA
// (relevantTopics=[CANDIDATE_REQUIREMENTS]) surfacea face-requirement-mandatory aunque pregunte por el movil, y
// la rama de la cara se disparaba por estar la entrada en el plan. FIX: la cara solo se recita si ella la SACO
// (objecion o mencion); si no, no se sermonea. Se simula el boost de la IA con un provider fake (relevantTopics).

function fakeUnderstanding(relevantTopics: string[]): ConversationUnderstandingProvider {
  return {
    async understand() {
      return ModelConversationOutputSchema.parse({
        intent: "REQUESTS_INFORMATION",
        confidence: 0.7,
        suggestedStateTransition: null,
        requiresHumanReview: false,
        humanReviewReason: null,
        response: "",
        relevantTopics
      });
    }
  };
}

function engineWith(relevantTopics: string[]) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: fakeUnderstanding(relevantTopics),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

async function seedAdult(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("La cara no se recita salvo que ella la saque (Alex 26-jun)", () => {
  it("pregunta por el MOVIL (la IA boostea CANDIDATE_REQUIREMENTS) -> NO recita la politica de la cara", async () => {
    const { engine, repository } = engineWith(["CANDIDATE_REQUIREMENTS"]);
    const c = await seedAdult(repository, "movil_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "que movil hace falta para trabajar" }]
    });
    expect(r.response.toLowerCase()).not.toMatch(/la cara es imprescindible|muchas chicas les pasa/);
  });

  it("si MENCIONA la cara -> si se aborda la politica de la cara", async () => {
    const { engine, repository } = engineWith(["CANDIDATE_REQUIREMENTS"]);
    const c = await seedAdult(repository, "cara_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo que mostrar la cara?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/cara|rostro|imprescindible|privacidad/);
  });
});
