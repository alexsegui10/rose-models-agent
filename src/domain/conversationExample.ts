import { z } from "zod";
import { CandidateStateSchema } from "./candidate";

export const ExampleCategorySchema = z.enum([
  "initial-contact",
  "private-profile",
  "requests-information",
  "requests-call",
  "provides-phone",
  "percentage-objection",
  "works-with-agency",
  "no-experience",
  "returning-lead",
  "waiting-review",
  "approved",
  "rejected",
  "human-takeover"
]);

export type ExampleCategory = z.infer<typeof ExampleCategorySchema>;

export const ExampleSourceTypeSchema = z.enum(["RAW_REAL", "CORRECTED", "ALEX_APPROVED", "EVALUATION_ONLY"]);
export type ExampleSourceType = z.infer<typeof ExampleSourceTypeSchema>;

export const ConversationExampleMessageSchema = z.object({
  role: z.enum(["candidate", "alex"]),
  content: z.string().min(1)
});

export const ConversationExampleSchema = z.object({
  id: z.string().min(1),
  category: ExampleCategorySchema,
  sourceType: ExampleSourceTypeSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  candidateContext: z.record(z.unknown()).default({}),
  stateBefore: CandidateStateSchema,
  intents: z.array(z.string()).default([]),
  messages: z.array(ConversationExampleMessageSchema).min(1),
  idealNextResponse: z.string().optional(),
  whyItIsGood: z.array(z.string()).default([]),
  undesirablePatterns: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  approvedByAlex: z.boolean(),
  qualityScore: z.number().min(0).max(1).optional(),
  useForGeneration: z.boolean().default(true)
});

export type ConversationExample = z.infer<typeof ConversationExampleSchema>;
export type ConversationExampleInput = z.input<typeof ConversationExampleSchema>;

export const GoldenConversationTestSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  initialCandidate: z.record(z.unknown()).default({}),
  stateBefore: CandidateStateSchema,
  messages: z.array(z.string().min(1)).min(1),
  expectedTransition: CandidateStateSchema.optional(),
  expectedExtractedFields: z.record(z.unknown()).default({}),
  responseMustIncludeAny: z.array(z.string()).default([]),
  responseMustNotInclude: z.array(z.string()).default([]),
  responseRequirements: z.array(z.string()).default([]),
  acceptableResponsePatterns: z.array(z.string()).default([])
});

export type GoldenConversationTest = z.infer<typeof GoldenConversationTestSchema>;
export type GoldenConversationTestInput = z.input<typeof GoldenConversationTestSchema>;
