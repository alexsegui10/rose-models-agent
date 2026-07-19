import { describe, expect, it } from "vitest";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { traceFromResult } from "@/application/evaluationRunner";
import {
  ModelConversationOutputSchema,
  ResponseDraftOutputSchema,
  type ConversationUnderstandingInput,
  type ModelConversationOutput,
  type ResponseDraftOutput
} from "@/application/llmProvider";
import {
  ApiConversationUnderstandingSchema,
  buildUnderstandingTextFormat,
  mapApiUnderstandingToModelOutput,
  OpenAIConversationUnderstandingProvider,
  type ApiConversationUnderstanding,
  type StructuredOutputRunner
} from "@/application/openaiProvider";

function apiExtractedDataAllNull(): ApiConversationUnderstanding["extractedData"] {
  return {
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
  };
}

function apiUnderstanding(overrides: Partial<ApiConversationUnderstanding> = {}): ApiConversationUnderstanding {
  return {
    intent: "PROVIDES_AGE",
    extractedData: apiExtractedDataAllNull(),
    dataCorrections: [],
    dataContradictions: [],
    confidence: 0.9,
    commercialQuestionsDetected: [],
    requestsCall: false,
    requestsHuman: false,
    isNegotiation: false,
    requestedModelPercentage: null,
    moneyTopic: "NONE",
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    internalNotes: [],
    relevantTopics: [],
    ...overrides
  };
}

function fakeRunner(output: unknown): StructuredOutputRunner {
  return {
    async runStructured() {
      return { parsed: output, inputTokens: 10, outputTokens: 5 };
    }
  };
}

function createProvider(runner: StructuredOutputRunner): OpenAIConversationUnderstandingProvider {
  return new OpenAIConversationUnderstandingProvider({
    apiKey: "test-key",
    understandingModel: "fake-understanding",
    writingModel: "fake-writing",
    timeoutMs: 100,
    maxRetries: 1,
    fallbackUnderstandingProvider: new DeterministicUnderstandingProvider(),
    runner
  });
}

function baseUnderstandingInput(inboundMessage: string): ConversationUnderstandingInput {
  return {
    candidateState: "QUALIFYING",
    knownData: {},
    recentMessages: ["Perfecto, ¿que edad tienes?"],
    inboundMessage
  };
}

function understandingTrace(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "PROVIDES_AGE",
    confidence: 0.9,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
}

function draftTrace(overrides: Partial<ResponseDraftOutput> = {}): ResponseDraftOutput {
  return ResponseDraftOutputSchema.parse({
    response: "Perfecto, gracias",
    provider: "openai",
    actualProvider: "openai",
    actualModel: "gpt-test",
    requestedProvider: "OPENAI",
    requestedModel: "gpt-test",
    usedFallback: false,
    fallbackReason: null,
    retryCount: 0,
    ...overrides
  });
}

describe("OPENAI_STRUCTURED_OUTPUT_SCHEMA", () => {
  it("maps the API-facing understanding shape (nulls) to a valid ModelConversationOutput without null leakage", () => {
    const parsed = ApiConversationUnderstandingSchema.parse(
      apiUnderstanding({
        extractedData: { ...apiExtractedDataAllNull(), age: 43, city: "Buenos Aires" }
      })
    );

    const mapped = mapApiUnderstandingToModelOutput(parsed);

    expect(mapped.extractedData).toEqual({ age: 43, city: "Buenos Aires" });
    const full = ModelConversationOutputSchema.parse(mapped);
    expect(full.intent).toBe("PROVIDES_AGE");
    expect(full.extractedData.firstName).toBeUndefined();
  });

  it("understands a bare '43' answer through the API-facing schema without falling back", async () => {
    const provider = createProvider(fakeRunner(apiUnderstanding({ extractedData: { ...apiExtractedDataAllNull(), age: 43 } })));

    const result = await provider.understand(baseUnderstandingInput("43"));

    expect(result.actualProvider).toBe("openai");
    expect(result.usedFallback).toBe(false);
    expect(result.retryCount).toBe(0);
    expect(result.extractedData.age).toBe(43);
  });

  it("generates a strict-compatible JSON schema: every property required, additionalProperties false, no defaults", () => {
    const format = buildUnderstandingTextFormat();

    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);

    const violations: string[] = [];
    walkSchema(format.schema, "#", violations);
    expect(violations).toEqual([]);

    const serialized = JSON.stringify(format.schema);
    expect(serialized).toContain('"firstName"');
    expect(serialized).not.toContain('"default"');
  });

  it("survives a salary demand mapped as an out-of-range percentage (regression replay-12 T5: 500 USD/semana crashed understanding)", async () => {
    const provider = createProvider(
      fakeRunner(
        apiUnderstanding({
          intent: "ASKS_ABOUT_PERCENTAGE",
          isNegotiation: true,
          requiresHumanReview: true,
          humanReviewReason: "Negociacion salarial: pide 500 dolares por semana.",
          requestedModelPercentage: 500,
          extractedData: { ...apiExtractedDataAllNull(), requestedModelPercentage: 500 }
        })
      )
    );

    const result = await provider.understand(baseUnderstandingInput("500 dolares por semana"));

    expect(result.usedFallback).toBe(false);
    expect(result.actualProvider).toBe("openai");
    expect(result.requestedModelPercentage).toBeNull();
    expect(result.extractedData.requestedModelPercentage).toBeUndefined();
    expect(result.isNegotiation).toBe(true);
    expect(result.requiresHumanReview).toBe(true);
    expect(result.internalNotes.join(" ")).toContain("fuera de rango");
  });

  it("rejects out-of-range model values after mapping and falls back deterministically", async () => {
    const provider = createProvider(fakeRunner(apiUnderstanding({ confidence: 2 })));

    const result = await provider.understand(baseUnderstandingInput("Tengo 22 anos"));

    expect(result.usedFallback).toBe(true);
    expect(result.actualProvider).toBe("deterministic");
    expect(result.fallbackReason).toBeTruthy();
    expect(result.extractedData.age).toBe(22);
  });

  it("marks the playback trace as fallback with a 'comprension:' reason when understanding fell back", () => {
    const trace = traceFromResult({
      understanding: understandingTrace({
        usedFallback: true,
        fallbackReason: "OPENAI_SCHEMA_REJECTED",
        actualProvider: "deterministic",
        retryCount: 1
      }),
      draft: draftTrace()
    });

    expect(trace.usedFallback).toBe(true);
    expect(trace.fallbackReason).toBe("comprension: OPENAI_SCHEMA_REJECTED");
    expect(trace.retryCount).toBe(1);
  });

  it("merges drafting fallback reasons with the 'redaccion:' prefix", () => {
    const trace = traceFromResult({
      understanding: understandingTrace({
        usedFallback: true,
        fallbackReason: "OPENAI_TIMEOUT",
        actualProvider: "deterministic",
        retryCount: 1
      }),
      draft: draftTrace({ usedFallback: true, fallbackReason: "empty-openai-draft", retryCount: 1 })
    });

    expect(trace.usedFallback).toBe(true);
    expect(trace.fallbackReason).toBe("comprension: OPENAI_TIMEOUT | redaccion: empty-openai-draft");
    expect(trace.retryCount).toBe(2);
  });

  it("keeps the trace clean when neither call fell back", () => {
    const trace = traceFromResult({
      understanding: understandingTrace({ actualProvider: "openai", usedFallback: false, retryCount: 0 }),
      draft: draftTrace()
    });

    expect(trace.usedFallback).toBe(false);
    expect(trace.fallbackReason).toBeNull();
    expect(trace.retryCount).toBe(0);
  });
});

function walkSchema(node: unknown, path: string, violations: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkSchema(item, `${path}[${index}]`, violations));
    return;
  }
  if (typeof node !== "object" || node === null) {
    return;
  }

  const record = node as Record<string, unknown>;
  if ("default" in record) {
    violations.push(`${path}: contiene "default"`);
  }

  const properties = record.properties;
  if (record.type === "object" && typeof properties === "object" && properties !== null) {
    if (record.additionalProperties !== false) {
      violations.push(`${path}: additionalProperties no es false`);
    }
    const required = Array.isArray(record.required) ? (record.required as unknown[]) : [];
    for (const key of Object.keys(properties)) {
      if (!required.includes(key)) {
        violations.push(`${path}: la propiedad "${key}" no esta en required`);
      }
    }
  }

  for (const [key, value] of Object.entries(record)) {
    walkSchema(value, `${path}/${key}`, violations);
  }
}
