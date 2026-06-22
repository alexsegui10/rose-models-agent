import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput
} from "@/application/llmProvider";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug 22-jun: ante "como funciona?" la comprension IA infirio hasOnlyFans=false (la dio por sin OF) y el
// bot se SALTO la pregunta de experiencia, yendo directo a agendar. Invariante 1: la IA no controla el
// flujo -> un hasOnlyFans=false inferido SIN respaldo deterministico se descarta y se sigue preguntando OF.

function understandingReturning(extractedData: ModelConversationOutput["extractedData"]): ConversationUnderstandingProvider {
  return {
    async understand() {
      return ModelConversationOutputSchema.parse({
        intent: "OTHER",
        extractedData,
        confidence: 0.8,
        suggestedStateTransition: null,
        requiresHumanReview: false,
        humanReviewReason: null,
        response: ""
      });
    }
  };
}

async function replyWith(provider: ConversationUnderstandingProvider, message: string) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: provider,
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  // Cualificacion con nombre + edad + movil resueltos, pero SIN OF contestado todavia.
  const seeded = await repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "of_infer", profileVisibility: "PUBLIC" }),
      firstName: "Laura",
      age: 35,
      isAdultConfirmed: true,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      currentState: "QUALIFYING"
    })
  );
  return engine.handleIncomingMessage({ candidateId: seeded.id, instagramUsername: seeded.instagramUsername, message });
}

describe("Invariante 1: la IA no salta la pregunta de OF infiriendo hasOnlyFans=false", () => {
  it("hasOnlyFans=false inferido por la IA sin respaldo -> se descarta (no se salta OF)", async () => {
    const reply = await replyWith(understandingReturning({ hasOnlyFans: false }), "como funciona?");
    // La inferencia NO debe fijar hasOnlyFans: sigue sin saberse, asi que el guion no esta completo.
    expect(reply.candidate.hasOnlyFans).toBeUndefined();
    expect(reply.candidate.currentState).not.toBe("WAITING_HUMAN_REVIEW");
  });

  it("hasOnlyFans=false CON respaldo deterministico (lo dice ella) SI se respeta", async () => {
    // Aqui el mensaje SI niega tener OF: el extractor deterministico lo confirma -> se mantiene false.
    const reply = await replyWith(understandingReturning({ hasOnlyFans: false }), "no tengo onlyfans la verdad");
    expect(reply.candidate.hasOnlyFans).toBe(false);
  });
});
