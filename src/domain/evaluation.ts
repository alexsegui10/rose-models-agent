import { z } from "zod";
import { CandidateStateSchema, ProfileVisibilitySchema } from "./candidate";
import { AlexStyleRatingSchema } from "./styleEvaluation";

export const ABWinnerSchema = z.enum(["A", "B", "TIE", "NONE"]);
export type ABWinner = z.infer<typeof ABWinnerSchema>;

export const EvaluationIssueSchema = z.enum([
  "FACTUAL_ERROR",
  "STATE_ERROR",
  "REPETITION",
  "TOO_FORMAL",
  "TOO_LONG",
  "UNNECESSARY_QUESTION",
  "MISSED_REAL_QUESTION"
]);
export type EvaluationIssue = z.infer<typeof EvaluationIssueSchema>;

export const ProviderCallTraceSchema = z.object({
  requestedProvider: z.string(),
  actualProvider: z.string(),
  requestedModel: z.string(),
  actualModel: z.string(),
  usedFallback: z.boolean(),
  fallbackReason: z.string().nullable(),
  durationMs: z.number().nonnegative(),
  retryCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  estimatedCostUsd: z.number().nonnegative().nullable()
});
export type ProviderCallTrace = z.infer<typeof ProviderCallTraceSchema>;

export const ABModelRunSchema = z.object({
  label: z.enum(["A", "B"]),
  model: z.string(),
  response: z.string(),
  stateAfter: CandidateStateSchema,
  providerTrace: ProviderCallTraceSchema,
  knowledgeEntryIds: z.array(z.string()),
  retrievedExampleIds: z.array(z.string()),
  factualValid: z.boolean(),
  styleScore: z.number().min(0).max(1)
});
export type ABModelRun = z.infer<typeof ABModelRunSchema>;

export const ABEvaluationCaseSchema = z.object({
  id: z.string(),
  createdAt: z.date(),
  blind: z.boolean(),
  initialState: CandidateStateSchema,
  profileVisibility: ProfileVisibilitySchema,
  messages: z.array(z.string()).min(1),
  modelA: z.string(),
  modelB: z.string(),
  runA: ABModelRunSchema,
  runB: ABModelRunSchema,
  winner: ABWinnerSchema.optional(),
  styleRating: AlexStyleRatingSchema.optional(),
  note: z.string().optional()
});
export type ABEvaluationCase = z.infer<typeof ABEvaluationCaseSchema>;

export const EvaluationTurnFeedbackSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  status: z.enum(["APPROVED", "EDITED", "REJECTED"]),
  originalResponse: z.string(),
  editedResponse: z.string().optional(),
  styleRating: AlexStyleRatingSchema.optional(),
  issues: z.array(EvaluationIssueSchema).default([]),
  note: z.string().optional()
});
export type EvaluationTurnFeedback = z.infer<typeof EvaluationTurnFeedbackSchema>;

// Instrumentacion aditiva: por turno registramos POR QUE escalo (la senal de revision humana del
// modelo de comprension tras el filtro de supresion benigna). Opcional/nullable para que los datos
// de playback antiguos sigan parseando sin migracion.
export const PlaybackTurnEscalationSchema = z.object({
  modelRequiresHumanReview: z.boolean(),
  modelHumanReviewReason: z.string().nullable()
});
export type PlaybackTurnEscalation = z.infer<typeof PlaybackTurnEscalationSchema>;

export const PlaybackTurnSchema = z.object({
  turnIndex: z.number().int().nonnegative(),
  candidateMessage: z.string().min(1),
  generatedResponse: z.string(),
  originalResponse: z.string().nullable(),
  resultingState: CandidateStateSchema,
  suggestedIssues: z.array(EvaluationIssueSchema).default([]),
  providerTrace: ProviderCallTraceSchema,
  escalation: PlaybackTurnEscalationSchema.nullish()
});
export type PlaybackTurn = z.infer<typeof PlaybackTurnSchema>;

export const EvaluationSessionSummarySchema = z.object({
  approvedWithoutChangesPct: z.number().nonnegative(),
  editedPct: z.number().nonnegative(),
  rejectedPct: z.number().nonnegative(),
  averageStyleRating: z.number().nullable(),
  factualErrors: z.number().int().nonnegative(),
  stateFailures: z.number().int().nonnegative(),
  repetitions: z.number().int().nonnegative(),
  model: z.string(),
  estimatedCostUsd: z.number().nonnegative(),
  averageLatencyMs: z.number().nonnegative()
});
export type EvaluationSessionSummary = z.infer<typeof EvaluationSessionSummarySchema>;

export const EvaluationSessionSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  model: z.string(),
  createdAt: z.date(),
  turnFeedback: z.array(EvaluationTurnFeedbackSchema).default([]),
  playbackTurns: z.array(PlaybackTurnSchema).optional(),
  summary: EvaluationSessionSummarySchema.optional()
});
export type EvaluationSession = z.infer<typeof EvaluationSessionSchema>;
