import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { parseAnonymizedConversationJson, approvedImportedConversationsForExamples } from "@/application/conversationImport";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createLlmProviders } from "@/application/llmFactory";
import { OpenAIConversationUnderstandingProvider, OpenAIResponseDraftingProvider, type StructuredOutputRunner } from "@/application/openaiProvider";
import { InMemoryConversationFeedbackRepository, recordConversationFeedback } from "@/application/responseFeedback";
import type { ConversationUnderstandingInput, ModelConversationOutput, ResponseDraftingProvider } from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function validUnderstanding(intent: ModelConversationOutput["intent"] = "CONFIRMS_INTEREST"): ModelConversationOutput {
  return {
    intent,
    extractedData: {},
    dataCorrections: [],
    dataContradictions: [],
    confidence: 0.9,
    commercialQuestionsDetected: [],
    requestsCall: false,
    requestsHuman: false,
    isNegotiation: false,
    requestedModelPercentage: null,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    internalNotes: [],
    provider: "openai",
    modelVersion: "fake-model",
    promptVersion: "fake-prompt"
  };
}

function fakeRunner(output: unknown, delayMs = 0): StructuredOutputRunner {
  return {
    async runStructured() {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return output;
    }
  };
}

function throwingRunner(error: Error): StructuredOutputRunner {
  return {
    async runStructured() {
      throw error;
    }
  };
}

function createEngine(options?: {
  automationMode?: "DRAFT_ONLY" | "HUMAN_APPROVAL" | "AUTOMATIC";
  draftingProvider?: ResponseDraftingProvider;
}) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    draftingProvider: options?.draftingProvider,
    automationMode: options?.automationMode
  });

  return { engine, repository };
}

describe("OpenAI adapter, automation and review", () => {
  it("keeps OpenAI disabled when the key is missing", () => {
    const providers = createLlmProviders({ LLM_MODE: "OPENAI" } as unknown as NodeJS.ProcessEnv);

    expect(providers.config.llmMode).toBe("DETERMINISTIC");
    expect(providers.draftingProvider).toBeUndefined();
  });

  it("uses OpenAI mode with provider configuration when a key exists", () => {
    const providers = createLlmProviders({ LLM_MODE: "OPENAI", OPENAI_API_KEY: "test-key" } as unknown as NodeJS.ProcessEnv);

    expect(providers.config.llmMode).toBe("OPENAI");
    expect(providers.draftingProvider).toBeDefined();
  });

  it("accepts valid structured understanding output", async () => {
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner(validUnderstanding("REQUESTS_INFORMATION"))
    });

    const result = await provider.understand(baseUnderstandingInput("Hola"));

    expect(result.provider).toBe("openai");
    expect(result.intent).toBe("REQUESTS_INFORMATION");
    expect(result.modelVersion).toBe("fake-understanding");
  });

  it("falls back when structured understanding output is invalid", async () => {
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner({ invalid: true })
    });

    const result = await provider.understand(baseUnderstandingInput("Tengo 22 anos"));

    expect(result.provider).toBe("deterministic-fallback");
    expect(result.extractedData.age).toBe(22);
  });

  it("falls back on timeout", async () => {
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 5,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner(validUnderstanding(), 30)
    });

    const result = await provider.understand(baseUnderstandingInput("Hola"));

    expect(result.provider).toBe("deterministic-fallback");
  });

  it("falls back on network errors", async () => {
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 1,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: throwingRunner(new Error("NETWORK_ERROR"))
    });

    const result = await provider.understand(baseUnderstandingInput("Hola"));

    expect(result.provider).toBe("deterministic-fallback");
  });

  it("uses deterministic drafting fallback when OpenAI drafting fails", async () => {
    const { engine } = createEngine({
      draftingProvider: new OpenAIResponseDraftingProvider({
        apiKey: "test-key",
        understandingModel: "fake-understanding",
        writingModel: "fake-writing",
        timeoutMs: 100,
        maxRetries: 0,
        runner: throwingRunner(new Error("NETWORK_ERROR"))
      })
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "draft_fallback",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    expect(result.draft.usedFallback).toBe(true);
    expect(result.response).toContain("edad");
  });

  it("blocks drafted percentages that are not allowed", async () => {
    const { engine } = createEngine({
      draftingProvider: { async draft() { return draft("Te damos el 90% sin problema."); } }
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "bad_percentage_draft",
      profileVisibility: "PUBLIC",
      message: "Que porcentaje seria?"
    });

    expect(result.response).not.toContain("90%");
    expect(result.draft.usedFallback).toBe(true);
  });

  it("blocks drafted claims that contradict knowledge", async () => {
    const { engine } = createEngine({
      draftingProvider: { async draft() { return draft("Tambien hacemos fotografias y viajes para todas las modelos."); } }
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "bad_service_draft",
      profileVisibility: "PUBLIC",
      message: "Que hace la agencia exactamente?"
    });

    expect(result.response.toLowerCase()).toContain("estrategia");
    expect(result.response.toLowerCase()).not.toContain("fotograf");
  });

  it("keeps DRAFT_ONLY responses out of outbound messages", async () => {
    const { engine, repository } = createEngine({ automationMode: "DRAFT_ONLY" });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "draft_only",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    const messages = await repository.listMessages(result.candidate.id);
    expect(result.deliveryStatus).toBe("DRAFT_ONLY");
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(0);
  });

  it("stores HUMAN_APPROVAL responses as pending drafts", async () => {
    const { engine, repository } = createEngine({ automationMode: "HUMAN_APPROVAL" });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "human_approval",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    const messages = await repository.listMessages(result.candidate.id);
    expect(result.deliveryStatus).toBe("PENDING_APPROVAL");
    expect(messages.at(-1)?.metadata?.deliveryStatus).toBe("PENDING_APPROVAL");
  });

  it("allows AUTOMATIC only when validation passes and no review is required", async () => {
    const { engine } = createEngine({ automationMode: "AUTOMATIC" });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "automatic_ok",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    expect(result.deliveryStatus).toBe("SENT");
  });

  it("blocks AUTOMATIC when human review is required", async () => {
    const { engine, repository } = createEngine({ automationMode: "AUTOMATIC" });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "automatic_blocked",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% a mi?"
    });

    const messages = await repository.listMessages(result.candidate.id);
    expect(result.deliveryStatus).toBe("BLOCKED");
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(0);
  });

  it("records human approval", async () => {
    const repository = new InMemoryConversationFeedbackRepository();
    const result = await recordConversationFeedback(repository, feedbackInput("APPROVED"));

    expect(result.approvedResponse?.response).toBe("Respuesta original");
  });

  it("records human edit and approval context", async () => {
    const repository = new InMemoryConversationFeedbackRepository();
    const result = await recordConversationFeedback(repository, {
      ...feedbackInput("EDITED"),
      editedResponse: "Respuesta editada"
    });

    expect(result.feedback.editedResponse).toBe("Respuesta editada");
  });

  it("records human rejection", async () => {
    const repository = new InMemoryConversationFeedbackRepository();
    const result = await recordConversationFeedback(repository, feedbackInput("REJECTED"));

    expect(result.feedback.status).toBe("REJECTED");
    expect(result.approvedResponse).toBeUndefined();
  });

  it("stores Alex style rating", async () => {
    const repository = new InMemoryConversationFeedbackRepository();
    const result = await recordConversationFeedback(repository, {
      ...feedbackInput("APPROVED"),
      styleRating: 5
    });

    expect(result.feedback.styleRating).toBe(5);
  });

  it("handles a complete multi-turn conversation", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "multi_turn",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "multi_turn",
      message: "Tengo 23 anos, soy de Madrid, tengo experiencia, estoy disponible por las tardes y tengo iPhone"
    });

    expect(second.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("does not repeat the age question after age is known", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "no_repeat",
      profileVisibility: "PUBLIC",
      message: "Tengo 23 anos"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "no_repeat",
      message: "Si, me interesa"
    });

    expect(second.response.toLowerCase()).not.toContain("edad tienes");
  });

  it("answers a new covered knowledge question", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "covered_question",
      profileVisibility: "PUBLIC",
      message: "Como funciona el proceso?"
    });

    expect(result.response.toLowerCase()).toContain("perfil");
    expect(result.responsePlan.knowledgeEntryIds).toContain("faq-how-it-works-covered");
  });

  it("escalates a new uncovered knowledge question", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "uncovered_question",
      profileVisibility: "PUBLIC",
      message: "La agencia se encarga tambien de mis impuestos?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.responsePlan.uncoveredQuestion).toBe(true);
  });

  it("imports only approved anonymized conversations as examples", () => {
    const file = parseAnonymizedConversationJson(
      JSON.stringify({
        version: "1",
        conversations: [
          {
            id: "ok",
            status: "ALEX_APPROVED",
            source: "ANONYMIZED_JSON",
            purpose: "EXAMPLE",
            stateBefore: "QUALIFYING",
            tags: ["approved"],
            messages: [{ role: "candidate", content: "Hola" }],
            idealNextResponse: "Hola, cuentame."
          },
          {
            id: "raw",
            status: "RAW_REAL",
            source: "ANONYMIZED_JSON",
            purpose: "EXAMPLE",
            stateBefore: "QUALIFYING",
            messages: [{ role: "candidate", content: "Hola" }],
            idealNextResponse: "No usar."
          }
        ]
      })
    );

    expect(approvedImportedConversationsForExamples(file)).toHaveLength(1);
  });

  it("rejects imported conversations with personal data", () => {
    expect(() =>
      parseAnonymizedConversationJson(
        JSON.stringify({
          version: "1",
          conversations: [
            {
              id: "pii",
              status: "ALEX_APPROVED",
              source: "ANONYMIZED_JSON",
              purpose: "EXAMPLE",
              stateBefore: "QUALIFYING",
              messages: [{ role: "candidate", content: "Mi telefono es 612345678" }]
            }
          ]
        })
      )
    ).toThrow(/personal data/);
  });
});

function baseUnderstandingInput(inboundMessage: string): ConversationUnderstandingInput {
  return {
    candidateState: "NEW_LEAD",
    knownData: {},
    recentMessages: [],
    inboundMessage
  };
}

function draft(response: string) {
  return {
    response,
    provider: "test",
    modelVersion: "test-model",
    promptVersion: "test-prompt",
    usedFallback: false
  };
}

function feedbackInput(status: "APPROVED" | "EDITED" | "REJECTED") {
  return {
    candidateId: "candidate",
    messageId: "message",
    status,
    originalResponse: "Respuesta original",
    state: "QUALIFYING" as const,
    contextSnapshot: "{}"
  };
}
