import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput,
  type ResponseDraftingProvider,
  type ResponseDraftOutput
} from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones halladas con la validacion OpenAI real (15-jun): la comprension/redaccion de OpenAI
// (a) soltaba la plantilla de RECHAZO ante la 1a duda de cara y (b) mandaba a contrato/HIR preguntas
// comerciales claramente respondibles (sueldo fijo, multi-agencia). El codigo determinista debe mandar.

const REJECTION =
  "Entiendo\n\nPero es nuestra manera de trabajar\n\nAsi que no podemos trabjar contigo lamentablemente\n\nEspero que te vaya genial, un saludo";

function stubDraftingProvider(text: string): ResponseDraftingProvider {
  return {
    async draft(): Promise<ResponseDraftOutput> {
      return {
        response: text,
        provider: "openai",
        modelVersion: "stub",
        promptVersion: "stub",
        usedFallback: false,
        requestedProvider: "OPENAI",
        actualProvider: "openai",
        requestedModel: "stub",
        actualModel: "stub",
        fallbackReason: null,
        durationMs: 1,
        retryCount: 0,
        inputTokens: 1,
        outputTokens: 1,
        estimatedCostUsd: 0
      };
    }
  };
}

function fixedUnderstanding(overrides: Partial<ModelConversationOutput>): ConversationUnderstandingProvider {
  const output = ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData: {},
    confidence: 0.9,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
  return {
    async understand() {
      return output;
    }
  };
}

async function seed(repository: InMemoryCandidateRepository, currentState: CandidateState) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "oa_fix_case", profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 24,
      isAdultConfirmed: true,
      currentState
    })
  );
}

describe("Cara: reconduccion determinista aunque OpenAI intente rechazar (validacion 15-jun)", () => {
  it("ante la 1a duda de cara reconduce y NO usa la plantilla de rechazo de OpenAI", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      draftingProvider: stubDraftingProvider(REJECTION),
      automationMode: "AUTOMATIC"
    });
    const seeded = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "oa_fix_case",
      // Frase exacta que fallaba en la validacion OpenAI: ni "no quiero", solo "me da cosa" + "tapar".
      message: "me da cosa salir con la cara, se puede tapar o algo?"
    });

    expect(result.candidate.currentState).not.toBe("CLOSED");
    expect(result.response.toLowerCase()).not.toContain("no podemos trabjar contigo");
    expect(result.response.toLowerCase()).toMatch(/imprescindible|te entiendo|privacidad/);
    // El texto entregado es el determinista (reconduccion), no el borrador de OpenAI.
    expect(result.draft.actualProvider).toBe("deterministic");
  });
});

describe("Comercial: preguntas respondibles no se escalan a HIR (validacion 15-jun)", () => {
  it("'es sueldo fijo o porcentaje?' se responde con porcentaje, no se escala", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      // OpenAI lo mando a contrato + revision humana: el codigo debe reclasificar y responder.
      understandingProvider: fixedUnderstanding({ intent: "ASKS_ABOUT_CONTRACT", requiresHumanReview: true }),
      automationMode: "AUTOMATIC"
    });
    const seeded = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "oa_fix_case",
      message: "oye y esto es un sueldo fijo o porcentaje?"
    });

    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toContain("porcentaje");
    // Invariante 3: NO se da la cifra de reparto si no la pide.
    expect(result.response).not.toMatch(/70|30/);
  });

  it("'ya trabajo con otra agencia, puedo estar en dos?' se responde, no se escala", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: fixedUnderstanding({ intent: "ASKS_ABOUT_CONTRACT", requiresHumanReview: true }),
      automationMode: "AUTOMATIC"
    });
    const seeded = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "oa_fix_case",
      message: "ya trabajo con otra agencia, puedo estar en dos agencias a la vez?"
    });

    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.deliveryStatus).toBe("SENT");
  });

  it("'cuanto os llevais exactamente?' responde el 70/30 y NO escala, pese a HR alucinado por OpenAI", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      // OpenAI marca revision humana y hasta alucina requestedModelPercentage en una simple pregunta de cifra.
      understandingProvider: fixedUnderstanding({
        intent: "ASKS_ABOUT_PERCENTAGE",
        requiresHumanReview: true,
        requestedModelPercentage: 70
      }),
      automationMode: "AUTOMATIC"
    });
    const seeded = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "oa_fix_case",
      message: "y cuanto os llevais vosotros exactamente?"
    });

    // Invariante 3: pide la cifra exacta -> se da el 70/30, y no se escala a Alex.
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response).toMatch(/70/);
    expect(result.response).toMatch(/30/);
  });

  it("una NEGOCIACION real de porcentaje SIGUE escalando a revision humana", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: fixedUnderstanding({ intent: "ASKS_ABOUT_PERCENTAGE", requiresHumanReview: true }),
      automationMode: "AUTOMATIC"
    });
    const seeded = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "oa_fix_case",
      message: "quiero quedarme el 80% para mi, si no no me interesa"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.deliveryStatus).toBe("BLOCKED");
  });
});
