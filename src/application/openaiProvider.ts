import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { CandidateStateSchema, DeviceEligibilitySchema, DeviceTypeSchema } from "@/domain/candidate";
import { promptRegistry } from "./promptRegistry";
import {
  ConversationIntentSchema,
  ModelConversationOutputSchema,
  ResponseDraftOutputSchema,
  type ConversationUnderstandingInput,
  type ConversationUnderstandingProvider,
  type ExtractedCandidateData,
  type ModelConversationOutput,
  type ResponseDraftingInput,
  type ResponseDraftingProvider,
  type ResponseDraftOutput
} from "./llmProvider";

// ---------------------------------------------------------------------------
// Esquema de cara a la API (OpenAI structured outputs en modo estricto).
//
// El modo estricto exige que TODAS las propiedades esten en `required`, que
// `additionalProperties` sea false y rechaza `.optional()` sin `.nullable()`
// y los `default`. Por eso el contrato interno (ModelConversationOutputSchema,
// lleno de optionals/defaults) NO puede enviarse a la API: el SDK lanza
// "Zod field ... uses `.optional()` without `.nullable()` which is not
// supported by the API" antes de hacer la peticion.
//
// Aqui el "dato ausente" se modela como null y se mapea despues al contrato
// interno (null -> campo omitido). Las restricciones de rango (confidence 0-1,
// porcentaje 0-100, edad positiva) se siguen validando tras el mapeo con
// ModelConversationOutputSchema, asi que ningun invariante se relaja.
// ---------------------------------------------------------------------------

const ApiExtractedCandidateDataSchema = z.object({
  firstName: z.string().nullable(),
  age: z.number().int().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  deviceType: DeviceTypeSchema.nullable(),
  deviceModel: z.string().nullable(),
  deviceEligibility: DeviceEligibilitySchema.nullable(),
  profileVisibility: z.enum(["PUBLIC", "PRIVATE", "UNKNOWN"]).nullable(),
  hasOnlyFans: z.boolean().nullable(),
  worksWithAnotherAgency: z.boolean().nullable(),
  experienceDescription: z.string().nullable(),
  currentMonthlyRevenue: z.number().nullable(),
  requestedModelPercentage: z.number().nullable(),
  contentAvailability: z.string().nullable(),
  goals: z.string().nullable(),
  objections: z.array(z.string()).nullable()
});

export const ApiConversationUnderstandingSchema = z.object({
  intent: ConversationIntentSchema,
  extractedData: ApiExtractedCandidateDataSchema,
  dataCorrections: z.array(z.string()),
  dataContradictions: z.array(z.string()),
  confidence: z.number(),
  commercialQuestionsDetected: z.array(z.string()),
  requestsCall: z.boolean(),
  requestsHuman: z.boolean(),
  isNegotiation: z.boolean(),
  requestedModelPercentage: z.number().nullable(),
  suggestedStateTransition: CandidateStateSchema.nullable(),
  requiresHumanReview: z.boolean(),
  humanReviewReason: z.string().nullable(),
  response: z.string(),
  internalNotes: z.array(z.string())
});

export type ApiConversationUnderstanding = z.infer<typeof ApiConversationUnderstandingSchema>;

type UnderstandingCoreFields = Pick<
  ModelConversationOutput,
  | "intent"
  | "extractedData"
  | "dataCorrections"
  | "dataContradictions"
  | "confidence"
  | "commercialQuestionsDetected"
  | "requestsCall"
  | "requestsHuman"
  | "isNegotiation"
  | "requestedModelPercentage"
  | "suggestedStateTransition"
  | "requiresHumanReview"
  | "humanReviewReason"
  | "response"
  | "internalNotes"
>;

export function mapApiUnderstandingToModelOutput(api: ApiConversationUnderstanding): UnderstandingCoreFields {
  return {
    intent: api.intent,
    extractedData: compactExtractedData(api.extractedData),
    dataCorrections: api.dataCorrections,
    dataContradictions: api.dataContradictions,
    confidence: api.confidence,
    commercialQuestionsDetected: api.commercialQuestionsDetected,
    requestsCall: api.requestsCall,
    requestsHuman: api.requestsHuman,
    isNegotiation: api.isNegotiation,
    requestedModelPercentage: api.requestedModelPercentage,
    suggestedStateTransition: api.suggestedStateTransition,
    requiresHumanReview: api.requiresHumanReview,
    humanReviewReason: api.humanReviewReason,
    response: api.response,
    internalNotes: api.internalNotes
  };
}

function compactExtractedData(data: ApiConversationUnderstanding["extractedData"]): ExtractedCandidateData {
  const result: ExtractedCandidateData = {};
  if (data.firstName !== null) result.firstName = data.firstName;
  if (data.age !== null) result.age = data.age;
  if (data.country !== null) result.country = data.country;
  if (data.city !== null) result.city = data.city;
  if (data.phone !== null) result.phone = data.phone;
  if (data.deviceType !== null) result.deviceType = data.deviceType;
  if (data.deviceModel !== null) result.deviceModel = data.deviceModel;
  if (data.deviceEligibility !== null) result.deviceEligibility = data.deviceEligibility;
  if (data.profileVisibility !== null) result.profileVisibility = data.profileVisibility;
  if (data.hasOnlyFans !== null) result.hasOnlyFans = data.hasOnlyFans;
  if (data.worksWithAnotherAgency !== null) result.worksWithAnotherAgency = data.worksWithAnotherAgency;
  if (data.experienceDescription !== null) result.experienceDescription = data.experienceDescription;
  if (data.currentMonthlyRevenue !== null) result.currentMonthlyRevenue = data.currentMonthlyRevenue;
  if (data.requestedModelPercentage !== null) result.requestedModelPercentage = data.requestedModelPercentage;
  if (data.contentAvailability !== null) result.contentAvailability = data.contentAvailability;
  if (data.goals !== null) result.goals = data.goals;
  if (data.objections !== null) result.objections = data.objections;
  return result;
}

/** Expuesto para tests de regresion: el JSON schema generado debe ser compatible con el modo estricto. */
export function buildUnderstandingTextFormat() {
  return zodTextFormat(ApiConversationUnderstandingSchema, "rose_understanding");
}

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
              schema: ApiConversationUnderstandingSchema,
              schemaName: "rose_understanding",
              instructions: buildUnderstandingInstructions(),
              payload: input,
              timeoutMs: this.options.timeoutMs
            }),
            this.options.timeoutMs
          ),
        this.options.maxRetries
      );

      // Doble validacion deliberada: protege frente a runners inyectados que no validen.
      const apiOutput = ApiConversationUnderstandingSchema.parse(result.value.parsed);

      return ModelConversationOutputSchema.parse({
        ...mapApiUnderstandingToModelOutput(apiOutput),
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
    "Rellena todos los campos del esquema y usa null cuando no haya dato real; no inventes valores.",
    "Si la candidata responde solo un numero a la pregunta de edad, es su edad.",
    "No decidas estados, transiciones ni acciones de negocio.",
    "Marca negociacion, solicitudes humanas, datos contradictorios y preguntas comerciales.",
    "Marca requiresHumanReview SOLO ante negociacion de condiciones, preguntas contractuales o legales, desconfianza o enfado, peticion explicita de hablar con una persona, o edad dudosa sin cifra adulta clara.",
    "NUNCA marques requiresHumanReview por datos normales de cualificacion: una edad adulta (18-50), tener o no tener OnlyFans, el modelo de movil, no trabajar con agencias o el pais NO requieren revision.",
    "No incluyas datos personales en notas internas salvo el campo estructurado correspondiente."
  ].join(" ");
}

function buildDraftingInstructions(): string {
  return [
    "Eres Alex, de Rose Models, escribiendo desde su propia cuenta de Instagram. Hablas SIEMPRE en primera persona como Alex; para el trabajo de la agencia usa 'nosotros' ('las cuentas las hacemos nosotros', 'hemos visto tu perfil').",
    "Nunca hables de Alex en tercera persona ni digas 'te paso con Alex' o 'lo consulto con Alex': tu eres Alex. Lo que no puedas resolver lo consultas con 'mi socio'.",
    "Nunca afirmes que ya hablaste con tu socio ni que algo ya se reviso, y no inventes esperas, plazos ni disculpas por tardanzas que no existen. Si hay que consultarlo, di que lo hablaras con tu socio y le diras ('Lo hablo con mi socio y te digo').",
    "'Lo hablo con mi socio' NO es una respuesta universal: solo vale para agendar la llamada o decisiones que de verdad estan pendientes. Si la candidata pregunta algo que el ResponsePlan responde (answerFacts), respondelo SIEMPRE con esos hechos.",
    "Responde PRIMERO a lo que la candidata acaba de preguntar o contar, usando solo hechos permitidos del ResponsePlan; nunca ignores una pregunta directa.",
    "No vuelques conocimiento que no ha pedido: si un dato del contexto no responde a su ultimo mensaje, no lo menciones.",
    "Despues haz como mucho la pregunta principal (mainQuestion), una sola pregunta por mensaje. Si mainQuestion es null, no hagas ninguna pregunta de cualificacion.",
    "Nunca repitas una pregunta que ya aparezca en los mensajes recientes del agente, aunque siga sin respuesta, y nunca repitas un mensaje tuyo anterior palabra por palabra.",
    "Nunca te despidas, rechaces o cierres la conversacion por tu cuenta: el rechazo solo existe si el plan lo indica. Un 'no' a una pregunta de datos no es un rechazo del proceso.",
    "Estilo Alex: 2-4 lineas cortas separadas por saltos de linea, una idea por linea, sin tildes en mensajes improvisados, acuse breve antes de avanzar ('Perfecto [nombre]' si dio un dato, 'Entiendo' para objeciones, 'Okeyy', 'Vale pues', 'Bien bien'), preguntas sin signo de apertura ('Que edad tienes?').",
    "Prohibido: lenguaje corporativo o de atencion al cliente, listas, parrafos largos, emojis, voseo argentino, y muletillas que Alex no usa ('curras', 'me cuadra', 'para darte la informacion correcta').",
    "Si confirma dia u hora para la llamada y no tenemos su telefono, pide el numero ('Pasame tu numero de telefono').",
    "Preguntas de dinero: nunca cifras por iniciativa propia; responde con los hechos permitidos y reconduce a la llamada, nunca a palo seco.",
    "No inventes porcentajes, cifras, condiciones, contratos, plazos de lanzamiento, aprobaciones ni ingresos.",
    "Devuelve solamente un objeto con response."
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
