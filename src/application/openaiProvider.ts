import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { promptRegistry } from "./promptRegistry";
import {
  ModelConversationOutputSchema,
  ResponseDraftOutputSchema,
  type ConversationUnderstandingInput,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput,
  type ResponseDraftingInput,
  type ResponseDraftingProvider,
  type ResponseDraftOutput
} from "./llmProvider";

export interface OpenAIProviderOptions {
  apiKey: string;
  understandingModel: string;
  writingModel: string;
  timeoutMs: number;
  maxRetries: number;
  fallbackUnderstandingProvider: ConversationUnderstandingProvider;
  runner?: StructuredOutputRunner;
}

export interface StructuredOutputRunner {
  runStructured<T extends z.ZodTypeAny>(input: {
    model: string;
    schema: T;
    schemaName: string;
    instructions: string;
    payload: unknown;
    timeoutMs: number;
  }): Promise<StructuredRunResult<z.infer<T>>>;
}

export interface StructuredRunResult<T> {
  parsed: T;
  inputTokens: number | null;
  outputTokens: number | null;
}

export class OpenAIStructuredOutputRunner implements StructuredOutputRunner {
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async runStructured<T extends z.ZodTypeAny>(input: {
    model: string;
    schema: T;
    schemaName: string;
    instructions: string;
    payload: unknown;
    timeoutMs: number;
  }): Promise<StructuredRunResult<z.infer<T>>> {
    const request = this.client.responses.parse({
      model: input.model,
      input: [
        { role: "system", content: input.instructions },
        { role: "user", content: JSON.stringify(input.payload) }
      ],
      text: {
        format: zodTextFormat(input.schema, input.schemaName)
      },
      truncation: "auto"
    });

    const response = await withTimeout(request, input.timeoutMs);
    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OPENAI_EMPTY_STRUCTURED_OUTPUT");
    }

    return {
      parsed: input.schema.parse(parsed),
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null
    };
  }
}

export class OpenAIConversationUnderstandingProvider implements ConversationUnderstandingProvider {
  private readonly runner: StructuredOutputRunner;

  constructor(private readonly options: OpenAIProviderOptions) {
    this.runner = options.runner ?? new OpenAIStructuredOutputRunner(options.apiKey);
  }

  async understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput> {
    const startedAt = Date.now();
    try {
      const result = await runWithRetries(
        () =>
          withTimeout(
            this.runner.runStructured({
              model: this.options.understandingModel,
              schema: ModelConversationOutputSchema,
              schemaName: "rose_understanding",
              instructions: buildUnderstandingInstructions(),
              payload: input,
              timeoutMs: this.options.timeoutMs
            }),
            this.options.timeoutMs
          ),
        this.options.maxRetries
      );

      return ModelConversationOutputSchema.parse({
        ...result.value.parsed,
        provider: "openai",
        modelVersion: this.options.understandingModel,
        promptVersion: promptRegistry.understanding.version,
        requestedProvider: "OPENAI",
        actualProvider: "openai",
        requestedModel: this.options.understandingModel,
        actualModel: this.options.understandingModel,
        usedFallback: false,
        fallbackReason: null,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
        inputTokens: result.value.inputTokens,
        outputTokens: result.value.outputTokens,
        estimatedCostUsd: estimateCostUsd(this.options.understandingModel, result.value.inputTokens, result.value.outputTokens)
      });
    } catch (error) {
      logSafeOpenAIError("understanding", error);
      const fallback = await this.options.fallbackUnderstandingProvider.understand(input);
      return {
        ...fallback,
        provider: "deterministic-fallback",
        requestedProvider: "OPENAI",
        actualProvider: "deterministic",
        requestedModel: this.options.understandingModel,
        actualModel: fallback.modelVersion,
        usedFallback: true,
        fallbackReason: safeErrorName(error),
        durationMs: Date.now() - startedAt,
        retryCount: this.options.maxRetries,
        internalNotes: [...fallback.internalNotes, "OpenAI understanding fallback used."]
      };
    }
  }
}

export class OpenAIResponseDraftingProvider implements ResponseDraftingProvider {
  private readonly runner: StructuredOutputRunner;

  constructor(private readonly options: Omit<OpenAIProviderOptions, "fallbackUnderstandingProvider">) {
    this.runner = options.runner ?? new OpenAIStructuredOutputRunner(options.apiKey);
  }

  async draft(input: ResponseDraftingInput): Promise<ResponseDraftOutput> {
    const startedAt = Date.now();
    try {
      const result = await runWithRetries(
        () =>
          withTimeout(
            this.runner.runStructured({
              model: this.options.writingModel,
              schema: ResponseDraftOutputSchema.pick({ response: true }),
              schemaName: "rose_draft",
              instructions: buildDraftingInstructions(),
              payload: input,
              timeoutMs: this.options.timeoutMs
            }),
            this.options.timeoutMs
          ),
        this.options.maxRetries
      );

      return ResponseDraftOutputSchema.parse({
        ...result.value.parsed,
        provider: "openai",
        modelVersion: this.options.writingModel,
        promptVersion: promptRegistry.drafting.version,
        requestedProvider: "OPENAI",
        actualProvider: "openai",
        requestedModel: this.options.writingModel,
        actualModel: this.options.writingModel,
        usedFallback: false,
        fallbackReason: null,
        durationMs: Date.now() - startedAt,
        retryCount: result.retryCount,
        inputTokens: result.value.inputTokens,
        outputTokens: result.value.outputTokens,
        estimatedCostUsd: estimateCostUsd(this.options.writingModel, result.value.inputTokens, result.value.outputTokens)
      });
    } catch (error) {
      logSafeOpenAIError("drafting", error);
      return ResponseDraftOutputSchema.parse({
        response: "",
        provider: "openai-failed",
        modelVersion: this.options.writingModel,
        promptVersion: promptRegistry.drafting.version,
        requestedProvider: "OPENAI",
        actualProvider: "none",
        requestedModel: this.options.writingModel,
        actualModel: this.options.writingModel,
        usedFallback: true,
        fallbackReason: safeErrorName(error),
        durationMs: Date.now() - startedAt,
        retryCount: this.options.maxRetries,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null,
        error: safeErrorName(error)
      });
    }
  }
}

async function runWithRetries<T>(operation: () => Promise<T>, maxRetries: number): Promise<{ value: T; retryCount: number }> {
  let lastError: unknown;
  const attempts = Math.max(1, maxRetries + 1);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return { value: await operation(), retryCount: attempt - 1 };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OPENAI_UNKNOWN_ERROR");
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error("OPENAI_TIMEOUT")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildUnderstandingInstructions(): string {
  return [
    "Eres el modulo de comprension estructurada de Rose Models.",
    "Devuelve solo datos estructurados validos.",
    "No decidas estados, transiciones ni acciones de negocio.",
    "Marca negociacion, solicitudes humanas, datos contradictorios y preguntas comerciales.",
    "No incluyas datos personales en notas internas salvo el campo estructurado correspondiente."
  ].join(" ");
}

function buildDraftingInstructions(): string {
  return [
    "Eres el redactor de borradores de Rose Models.",
    "Devuelve solamente un objeto con response.",
    "No inventes porcentajes, condiciones, contratos, aprobaciones ni ingresos.",
    "Usa solo hechos permitidos del ResponsePlan y una pregunta principal si existe.",
    "Si falta cobertura factual, deriva con naturalidad a Alex o su socio."
  ].join(" ");
}

function logSafeOpenAIError(stage: string, error: unknown): void {
  console.warn("[openai-provider]", {
    stage,
    error: safeErrorName(error)
  });
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "unknown";
}

// Tarifas oficiales (developers.openai.com/api/docs/pricing, verificadas 10-jun-2026).
// Si OpenAI cambia precios, actualizar aqui y en tests/openaiCostEstimation.test.ts.
export function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens === null || outputTokens === null) return null;

  const lowerModel = model.toLowerCase();
  const rates = lowerModel.includes("gpt-5.4-mini")
    ? { inputPerMillion: 0.75, outputPerMillion: 4.5 }
    : lowerModel.includes("gpt-5.4-nano")
      ? { inputPerMillion: 0.2, outputPerMillion: 1.25 }
      : lowerModel.includes("gpt-4.1-mini")
        ? { inputPerMillion: 0.4, outputPerMillion: 1.6 }
        : null;

  if (!rates) return null;

  return (inputTokens / 1_000_000) * rates.inputPerMillion + (outputTokens / 1_000_000) * rates.outputPerMillion;
}
