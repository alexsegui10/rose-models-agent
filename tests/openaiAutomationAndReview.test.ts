import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { parseAnonymizedConversationJson, approvedImportedConversationsForExamples } from "@/application/conversationImport";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createLlmProviders } from "@/application/llmFactory";
import {
  ApiConversationUnderstandingSchema,
  OpenAIConversationUnderstandingProvider,
  OpenAIResponseDraftingProvider,
  type ApiConversationUnderstanding,
  type StructuredOutputRunner
} from "@/application/openaiProvider";
import { InMemoryConversationFeedbackRepository, recordConversationFeedback } from "@/application/responseFeedback";
import {
  ResponseDraftOutputSchema,
  type ConversationUnderstandingInput,
  type ModelConversationOutput,
  type ResponseDraftingProvider
} from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// El runner devuelve ahora la forma de cara a la API (modo estricto de structured outputs):
// todos los campos presentes y "sin dato" modelado como null, nunca como campo ausente.
function validUnderstanding(intent: ModelConversationOutput["intent"] = "CONFIRMS_INTEREST"): ApiConversationUnderstanding {
  return ApiConversationUnderstandingSchema.parse({
    intent,
    extractedData: {
      firstName: null,
      age: null,
      country: null,
      city: null,
      phone: null,
      deviceType: null,
      deviceModel: null,
      deviceEligibility: null,
      profileVisibility: null,
      hasOnlyFans: null,
      worksWithAnotherAgency: null,
      experienceDescription: null,
      currentMonthlyRevenue: null,
      requestedModelPercentage: null,
      contentAvailability: null,
      goals: null,
      objections: null
    },
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
    relevantTopics: []
  });
}

function fakeRunner(output: unknown, delayMs = 0): StructuredOutputRunner {
  return {
    async runStructured() {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return { parsed: output, inputTokens: 10, outputTokens: 5 };
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

  it("discards the LLM device eligibility and derives it deterministically (invariante 1)", async () => {
    // El LLM alucina NOT_ELIGIBLE de un mensaje sin movil ('malo y viejo'): el adaptador lo DESCARTA,
    // la elegibilidad del movil es regla de hardware determinista, no opinion del modelo.
    const hallucinated = validUnderstanding();
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner({
        ...hallucinated,
        extractedData: { ...hallucinated.extractedData, deviceEligibility: "NOT_ELIGIBLE" }
      })
    });

    const result = await provider.understand(baseUnderstandingInput("perdona estoy un poco malo y viejo para esto"));
    expect(result.extractedData.deviceEligibility).toBeUndefined();
  });

  it("discards hallucinated hasOnlyFans / worksWithAnotherAgency so OF and agency questions are not skipped", async () => {
    // El LLM ponia hasOnlyFans=false y worksWithAnotherAgency=false desde "me interesa" (sin que la
    // candidata dijera nada) -> el planner daba esos slots por respondidos y saltaba esas preguntas.
    const hallucinated = validUnderstanding();
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner({
        ...hallucinated,
        extractedData: { ...hallucinated.extractedData, hasOnlyFans: false, worksWithAnotherAgency: false }
      })
    });

    const result = await provider.understand(baseUnderstandingInput("Hola, me interesa. Tengo 22 anos y soy de Madrid."));
    expect(result.extractedData.hasOnlyFans).toBeUndefined();
    expect(result.extractedData.worksWithAnotherAgency).toBeUndefined();
  });

  it("derives device eligibility from a misspelled iphone so the slot is not re-asked (ipone 13 -> APPROVED)", async () => {
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner(validUnderstanding())
    });

    const result = await provider.understand(baseUnderstandingInput("tengo un ipone 13"));
    expect(result.extractedData.deviceEligibility).toBe("APPROVED");
  });

  it("still flags a genuinely bad phone as NOT_ELIGIBLE when a device is actually named", async () => {
    // El gating descarta 'malo/viejo' SIN movil (puede referirse a la persona), pero si la candidata
    // nombra el movil ('movil viejo y malo'), el gate de hardware determinista SI debe rechazarlo.
    const provider = new OpenAIConversationUnderstandingProvider({
      apiKey: "test-key",
      understandingModel: "fake-understanding",
      writingModel: "fake-writing",
      timeoutMs: 100,
      maxRetries: 0,
      fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
      runner: fakeRunner(validUnderstanding())
    });

    const result = await provider.understand(baseUnderstandingInput("tengo un movil viejo y malo"));
    expect(result.extractedData.deviceEligibility).toBe("NOT_ELIGIBLE");
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

    const opener = await engine.handleIncomingMessage({
      instagramUsername: "draft_fallback",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    // El primer turno es la plantilla canonica deterministica (no pasa por OpenAI).
    expect(opener.response).toContain("Rose Models");

    // Un turno que SI pasa por OpenAI (pregunta con respuesta de conocimiento; los turnos de solo
    // pregunta de cualificacion ya son deterministas por diseno). Si OpenAI falla -> fallback honesto.
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "draft_fallback",
      message: "que hace la agencia exactamente?"
    });

    expect(result.draft.usedFallback).toBe(true);
    expect(result.response.trim().length).toBeGreaterThan(0);
    // Invariante 6: la respuesta entregada es deterministica, la traza NO puede acreditarla a OpenAI.
    expect(result.draft.actualProvider).toBe("deterministic");
    expect(result.draft.provider).toBe("deterministic");
    // ...pero SI pedimos a OpenAI: requestedProvider sigue siendo honesto.
    expect(result.draft.requestedProvider).toBe("OPENAI");
  });

  it("does not credit OpenAI when an empty OpenAI draft falls back to the deterministic reply", async () => {
    const { engine } = createEngine({
      draftingProvider: {
        async draft() {
          // OpenAI responde con exito pero el texto es solo espacios (parsea: response no tiene .min(1)).
          return ResponseDraftOutputSchema.parse({
            response: "   ",
            provider: "openai",
            modelVersion: "fake-writing",
            promptVersion: "test-prompt",
            requestedProvider: "OPENAI",
            actualProvider: "openai",
            requestedModel: "fake-writing",
            actualModel: "fake-writing",
            usedFallback: false,
            fallbackReason: null,
            durationMs: 5,
            retryCount: 0,
            inputTokens: 10,
            outputTokens: 0,
            estimatedCostUsd: 0.001
          });
        }
      }
    });

    const opener = await engine.handleIncomingMessage({
      instagramUsername: "empty_openai_draft",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "empty_openai_draft",
      message: "que hace la agencia exactamente?"
    });

    expect(result.response.trim().length).toBeGreaterThan(0);
    expect(result.draft.usedFallback).toBe(true);
    expect(result.draft.actualProvider).toBe("deterministic");
    expect(result.draft.provider).toBe("deterministic");
    expect(result.draft.requestedProvider).toBe("OPENAI");
  });

  it("blocks drafted percentages that are not allowed", async () => {
    const { engine } = createEngine({
      draftingProvider: {
        async draft() {
          return draft("Te damos el 90% sin problema.");
        }
      }
    });

    const opener = await engine.handleIncomingMessage({
      instagramUsername: "bad_percentage_draft",
      profileVisibility: "PUBLIC",
      message: "Hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "bad_percentage_draft",
      message: "Que porcentaje seria?"
    });

    expect(result.response).not.toContain("90%");
    expect(result.draft.usedFallback).toBe(true);
  });

  it("blocks drafted claims that contradict knowledge", async () => {
    const { engine } = createEngine({
      draftingProvider: {
        async draft() {
          return draft("Tambien hacemos fotografias y viajes para todas las modelos.");
        }
      }
    });

    const opener = await engine.handleIncomingMessage({
      instagramUsername: "bad_service_draft",
      profileVisibility: "PUBLIC",
      message: "Hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "bad_service_draft",
      message: "Que hace la agencia exactamente?"
    });

    expect(result.response.toLowerCase()).toContain("estrategia");
    expect(result.response.toLowerCase()).not.toContain("fotograf");
  });

  // Actualizado 2026-06-11: el borrador SI se guarda como historial marcado DRAFT_ONLY (lo necesita
  // el guard anti-repeticion en playback); la garantia que se mantiene es que NUNCA se marca SENT.
  it("keeps DRAFT_ONLY responses as drafts, never as sent outbound messages", async () => {
    const { engine, repository } = createEngine({ automationMode: "DRAFT_ONLY" });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "draft_only",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    const messages = await repository.listMessages(result.candidate.id);
    const agentMessages = messages.filter((message) => message.role === "agent");
    expect(result.deliveryStatus).toBe("DRAFT_ONLY");
    expect(agentMessages).toHaveLength(1);
    expect(agentMessages[0]?.metadata?.deliveryStatus).toBe("DRAFT_ONLY");
    expect(agentMessages.some((message) => message.metadata?.deliveryStatus === "SENT")).toBe(false);
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
      message:
        "Tengo 23 anos, soy de Madrid, tengo experiencia, nunca he tenido OnlyFans, estoy disponible por las tardes y tengo iPhone 13"
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
  return ResponseDraftOutputSchema.parse({
    response,
    provider: "test",
    modelVersion: "test-model",
    promptVersion: "test-prompt",
    requestedProvider: "TEST",
    actualProvider: "test",
    requestedModel: "test-model",
    actualModel: "test-model",
    usedFallback: false,
    fallbackReason: null,
    durationMs: 1,
    retryCount: 0,
    inputTokens: 10,
    outputTokens: 5,
    estimatedCostUsd: 0.001
  });
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
