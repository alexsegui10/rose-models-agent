import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug cazado en la simulacion completa (6-jul): a "Nunca" (sin OF), el bot solto "La cara es imprescindible
// para nuestra estrategia" de la nada (ella NO menciono la cara). El guardrail anti "hablar de mas" quitaba
// esas lineas, pero como TODA la respuesta era la cara, quedaba vacio y ANTES se dejaba pasar la original.
// Ahora un tema suprimido nunca puede ser el turno entero: se sustituye por algo seguro.

function fakeDrafter(text: string): ResponseDraftingProvider {
  return {
    async draft() {
      return ResponseDraftOutputSchema.parse({
        response: text,
        provider: "test",
        modelVersion: "t",
        promptVersion: "t",
        requestedProvider: "TEST",
        actualProvider: "test",
        requestedModel: "t",
        actualModel: "t",
        usedFallback: false,
        fallbackReason: null,
        durationMs: 1,
        retryCount: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null
      });
    }
  };
}

function engineWith(drafter: ResponseDraftingProvider) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    draftingProvider: drafter,
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

async function seedQualifying(repository: InMemoryCandidateRepository, username: string) {
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

describe("Un tema suprimido NUNCA es el turno entero (bug cara-de-la-nada, sim 6-jul)", () => {
  it("si el borrador suelta SOLO la cara y ella no la menciono, la respuesta final NO habla de la cara", async () => {
    const { engine, repository } = engineWith(
      fakeDrafter("La cara es imprescindible para nuestra estrategia.\n\nEs imprescindible para generar el trafico.")
    );
    const c = await seedQualifying(repository, "supp_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale genial" }]
    });
    const lower = r.response.toLowerCase();
    // No se suelta la cara de la nada.
    expect(lower).not.toMatch(/la cara|imprescindible para/);
    // Y no se queda vacia (algo seguro sale).
    expect(r.response.trim().length).toBeGreaterThan(0);
  });
});
