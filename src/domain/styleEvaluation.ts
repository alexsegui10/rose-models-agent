import { z } from "zod";
import { CandidateStateSchema } from "./candidate";

export const StyleEvaluationSchema = z.object({
  isSpanishFromSpain: z.boolean(),
  soundsNatural: z.boolean(),
  soundsLikeAlex: z.boolean(),
  isTooFormal: z.boolean(),
  isTooLong: z.boolean(),
  soundsRobotic: z.boolean(),
  repeatsKnownInformation: z.boolean(),
  asksTooManyQuestions: z.boolean(),
  usesForbiddenExpression: z.boolean(),
  addressesCandidateMessage: z.boolean(),
  score: z.number().min(0).max(1),
  reasons: z.array(z.string())
});

export type StyleEvaluation = z.infer<typeof StyleEvaluationSchema>;

export const ConversationFeedbackStatusSchema = z.enum(["APPROVED", "EDITED", "REJECTED"]);
export type ConversationFeedbackStatus = z.infer<typeof ConversationFeedbackStatusSchema>;

export const AlexStyleRatingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type AlexStyleRating = z.infer<typeof AlexStyleRatingSchema>;

export const ConversationFeedbackSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  messageId: z.string().optional(),
  status: ConversationFeedbackStatusSchema,
  originalResponse: z.string(),
  editedResponse: z.string().optional(),
  reason: z.string().optional(),
  styleRating: AlexStyleRatingSchema.optional(),
  state: CandidateStateSchema,
  contextSnapshot: z.string(),
  createdAt: z.date(),
  styleProfileVersion: z.string(),
  promptVersion: z.string(),
  modelVersion: z.string()
});

export type ConversationFeedback = z.infer<typeof ConversationFeedbackSchema>;

export const ApprovedResponseSchema = z.object({
  id: z.string(),
  feedbackId: z.string(),
  response: z.string(),
  state: CandidateStateSchema,
  tags: z.array(z.string()).default([]),
  approvedAt: z.date(),
  styleProfileVersion: z.string(),
  promptVersion: z.string(),
  modelVersion: z.string()
});

export type ApprovedResponse = z.infer<typeof ApprovedResponseSchema>;
