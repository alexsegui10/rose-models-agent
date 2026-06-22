import { z } from "zod";
import { CandidateStateSchema, DeviceEligibilitySchema, DeviceTypeSchema } from "@/domain/candidate";

export const ConversationIntentSchema = z.enum([
  "REQUESTS_INFORMATION",
  "CONFIRMS_INTEREST",
  "PROVIDES_NAME",
  "PROVIDES_AGE",
  "PROVIDES_PHONE",
  "ACCEPTS_PROFILE_REQUEST",
  "REQUESTS_CALL",
  "ASKS_ABOUT_PERCENTAGE",
  "ASKS_ABOUT_CONTRACT",
  "DECLINES",
  "REQUESTS_HUMAN",
  "PROMPT_INJECTION",
  "UNCLEAR",
  "OTHER"
]);

export type ConversationIntent = z.infer<typeof ConversationIntentSchema>;

export const ExtractedCandidateDataSchema = z.object({
  firstName: z.string().optional(),
  age: z.number().int().positive().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  deviceType: DeviceTypeSchema.optional(),
  deviceModel: z.string().nullable().optional(),
  deviceEligibility: DeviceEligibilitySchema.optional(),
  profileVisibility: z.enum(["PUBLIC", "PRIVATE", "UNKNOWN"]).optional(),
  hasOnlyFans: z.boolean().optional(),
  worksWithAnotherAgency: z.boolean().optional(),
  experienceDescription: z.string().optional(),
  currentMonthlyRevenue: z.number().nonnegative().optional(),
  requestedModelPercentage: z.number().min(0).max(100).optional(),
  contentAvailability: z.string().optional(),
  goals: z.string().optional(),
  objections: z.array(z.string()).optional()
});

export type ExtractedCandidateData = z.infer<typeof ExtractedCandidateDataSchema>;

export const ModelConversationOutputSchema = z.object({
  intent: ConversationIntentSchema,
  extractedData: ExtractedCandidateDataSchema.default({}),
  dataCorrections: z.array(z.string()).default([]),
  dataContradictions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  commercialQuestionsDetected: z.array(z.string()).default([]),
  requestsCall: z.boolean().default(false),
  requestsHuman: z.boolean().default(false),
  isNegotiation: z.boolean().default(false),
  requestedModelPercentage: z.number().min(0).max(100).nullable().default(null),
  // Senal ORTOGONAL (no es un intent): la candidata hizo una pregunta PERSONAL/SOCIAL dirigida al bot
  // ("y tu?", "quien eres?", "como estas?") que no es de negocio ni de seguridad. Informa al planner para
  // responderla primero y reconducir; NUNCA decide estado/flujo (invariante 1). Default null.
  pendingPersonalQuestion: z
    .object({ kind: z.enum(["IDENTITY", "RECIPROCAL_PERSONAL", "GREETING"]) })
    .nullable()
    .default(null),
  suggestedStateTransition: CandidateStateSchema.nullable(),
  requiresHumanReview: z.boolean(),
  humanReviewReason: z.string().nullable(),
  response: z.string(),
  internalNotes: z.array(z.string()).default([]),
  provider: z.string().default("deterministic"),
  modelVersion: z.string().default("deterministic-local-2026-06-08.1"),
  promptVersion: z.string().default("understanding-2026-06-08.1"),
  requestedProvider: z.string().default("DETERMINISTIC"),
  actualProvider: z.string().default("deterministic"),
  requestedModel: z.string().default("deterministic-local-2026-06-08.1"),
  actualModel: z.string().default("deterministic-local-2026-06-08.1"),
  usedFallback: z.boolean().default(false),
  fallbackReason: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().default(0),
  retryCount: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  estimatedCostUsd: z.number().nonnegative().nullable().default(null)
});

export type ModelConversationOutput = z.infer<typeof ModelConversationOutputSchema>;

export interface ConversationUnderstandingInput {
  candidateState: string;
  knownData: Record<string, string | number | boolean | null>;
  recentMessages: string[];
  inboundMessage: string;
}

export interface ConversationUnderstandingProvider {
  understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput>;
}

export interface ResponseDraftingInput {
  candidateState: string;
  memory: Record<string, string | number | boolean | null>;
  recentMessages: string[];
  conversationSummary: string;
  responsePlan: unknown;
  knowledgeEntries: unknown[];
  retrievedExamples: unknown[];
  styleContext: string;
  allowedFacts: string[];
  prohibitedClaims: string[];
  mainQuestion: string | null;
}

export const ResponseDraftOutputSchema = z.object({
  response: z.string(),
  provider: z.string().default("deterministic"),
  modelVersion: z.string().default("deterministic-local-2026-06-08.1"),
  promptVersion: z.string().default("drafting-2026-06-08.1"),
  usedFallback: z.boolean().default(false),
  error: z.string().optional(),
  requestedProvider: z.string().default("DETERMINISTIC"),
  actualProvider: z.string().default("deterministic"),
  requestedModel: z.string().default("deterministic-local-2026-06-08.1"),
  actualModel: z.string().default("deterministic-local-2026-06-08.1"),
  fallbackReason: z.string().nullable().default(null),
  durationMs: z.number().nonnegative().default(0),
  retryCount: z.number().int().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  estimatedCostUsd: z.number().nonnegative().nullable().default(null)
});

export type ResponseDraftOutput = z.infer<typeof ResponseDraftOutputSchema>;

export interface ResponseDraftingProvider {
  draft(input: ResponseDraftingInput): Promise<ResponseDraftOutput>;
}
