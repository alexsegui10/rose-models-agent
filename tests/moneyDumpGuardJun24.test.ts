import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Alex 24-jun: el bot soltaba el modelo de pago ("trabajamos a porcentaje, no salario fijo") cuando ella NO
// preguntaba por dinero (al preguntar por la edad/encaje). El LLM lo añadia por su cuenta. GUARDRAIL: si NO se
// pregunto por dinero (segun SUS palabras), se quitan las burbujas con el modelo de pago. Si SI pregunto, se
// mantienen. Refuerza invariante 3 (el dinero nunca es proactivo).

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

describe("Guardrail: no soltar el modelo de pago si no se pregunta por dinero (Alex 24-jun)", () => {
  it("pregunta NO-dinero: la burbuja con 'porcentaje/salario' que cuela el borrador se ELIMINA", async () => {
    const drafted = "Con eso nos encaja muy bien\n\nSolemos trabajar a porcentaje, no con salario fijo\n\nY que movil tienes?";
    const { engine, repository } = engineWith(fakeDrafter(drafted));
    const seeded = await seedQualifying(repository, "md1");

    const r = await engine.handleIncomingTurn({
      instagramUsername: seeded.instagramUsername,
      messages: [{ content: "que hace la agencia exactamente?" }]
    });

    expect(r.response.toLowerCase()).not.toMatch(/porcentaje|salario fijo|reparto/);
    expect(r.response.trim().length).toBeGreaterThan(0);
  });

  it("pregunta de DINERO ('salario fijo o porcentaje?'): el modelo de pago SI se mantiene", async () => {
    const drafted = "Solemos trabajar a porcentaje, no con salario fijo\n\nY que movil tienes?";
    const { engine, repository } = engineWith(fakeDrafter(drafted));
    const seeded = await seedQualifying(repository, "md2");

    const r = await engine.handleIncomingTurn({
      instagramUsername: seeded.instagramUsername,
      messages: [{ content: "es salario fijo o porcentaje?" }]
    });

    expect(r.response.toLowerCase()).toMatch(/porcentaje/);
  });
});
