import { z } from "zod";
import { CandidateStateSchema } from "@/domain/candidate";

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
  phoneDeviceType: z.enum(["IPHONE", "ANDROID", "OTHER", "UNKNOWN"]).optional(),
  hasRequiredIPhone: z.boolean().nullable().optional(),
  profileVisibility: z.enum(["UNKNOWN", "PUBLIC", "PRIVATE", "UNAVAILABLE"]).optional(),
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
  suggestedStateTransition: CandidateStateSchema.nullable(),
  requiresHumanReview: z.boolean(),
  humanReviewReason: z.string().nullable(),
  response: z.string(),
  internalNotes: z.array(z.string()).default([]),
  provider: z.string().default("deterministic"),
  modelVersion: z.string().default("deterministic-local-2026-06-08.1"),
  promptVersion: z.string().default("understanding-2026-06-08.1")
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
  error: z.string().optional()
});

export type ResponseDraftOutput = z.infer<typeof ResponseDraftOutputSchema>;

export interface ResponseDraftingProvider {
  draft(input: ResponseDraftingInput): Promise<ResponseDraftOutput>;
}
