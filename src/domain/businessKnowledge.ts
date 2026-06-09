import { z } from "zod";
import { CandidateStateSchema, HumanReviewReasonSchema } from "./candidate";

export const KnowledgeCategorySchema = z.enum([
  "AGENCY_PROFILE",
  "SERVICES",
  "COMMERCIAL",
  "CANDIDATE_REQUIREMENTS",
  "CONTENT_RESPONSIBILITIES",
  "FAQ",
  "OBJECTION_HANDLING",
  "CALL_POLICY",
  "CONTRACT_POLICY",
  "ESCALATION_POLICY"
]);

export type KnowledgeCategory = z.infer<typeof KnowledgeCategorySchema>;

export const KnowledgeStatusSchema = z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]);
export type KnowledgeStatus = z.infer<typeof KnowledgeStatusSchema>;

export const RevenueSharePolicySchema = z
  .object({
    agencyPercentage: z.number().min(0).max(100).nullable(),
    modelPercentage: z.number().min(0).max(100).nullable(),
    isConfirmed: z.boolean(),
    discloseOnlyWhenExplicitlyAsked: z.literal(true),
    canExplainNoFixedSalaryInChat: z.literal(true),
    canDiscloseExactPercentagesInChat: z.boolean(),
    canNegotiateByChat: z.literal(false),
    negotiationRequiresHumanReview: z.literal(true),
    approvedGeneralExplanation: z.string().min(1),
    approvedPercentageExplanation: z.string().nullable(),
    minimumAgencyPercentage: z.number().min(0).max(100).nullable(),
    maximumModelPercentage: z.number().min(0).max(100).nullable(),
    version: z.string()
  })
  .superRefine((value, context) => {
    if (value.isConfirmed) {
      if (value.agencyPercentage === null || value.modelPercentage === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Confirmed revenue share must include both percentages."
        });
        return;
      }

      if (value.agencyPercentage + value.modelPercentage !== 100) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Confirmed revenue share percentages must sum 100."
        });
      }
    }
  });

export type RevenueSharePolicy = z.infer<typeof RevenueSharePolicySchema>;

export const CandidateDeviceRequirementSchema = z.object({
  requiredDevice: z.literal("IPHONE"),
  isMandatory: z.literal(true),
  mustBeConfirmedBeforeHumanFinalApproval: z.literal(true),
  approvedQuestion: z.string().min(1),
  rejectionOrPausePolicy: z.string().min(1),
  version: z.string().min(1)
});

export type CandidateDeviceRequirement = z.infer<typeof CandidateDeviceRequirementSchema>;

export const QualificationReadinessSchema = z.object({
  isReady: z.boolean(),
  missingRequiredFields: z.array(z.string()).default([]),
  blockingReasons: z.array(z.string()).default([])
});

export type QualificationReadiness = z.infer<typeof QualificationReadinessSchema>;

export const NegotiationDecisionSchema = z
  .object({
    candidateId: z.string(),
    requestedModelPercentage: z.number().min(0).max(100).nullable(),
    currentPolicyAgencyPercentage: z.number().min(0).max(100).nullable(),
    currentPolicyModelPercentage: z.number().min(0).max(100).nullable(),
    decision: z.enum(["KEEP_STANDARD_TERMS", "ALLOW_CUSTOM_TERMS", "REJECT_NEGOTIATION", "DISCUSS_IN_CALL"]),
    approvedAgencyPercentage: z.number().min(0).max(100).nullable(),
    approvedModelPercentage: z.number().min(0).max(100).nullable(),
    reason: z.string(),
    decidedBy: z.string(),
    decidedAt: z.date()
  })
  .superRefine((value, context) => {
    if (value.decision === "ALLOW_CUSTOM_TERMS") {
      if (value.approvedAgencyPercentage === null || value.approvedModelPercentage === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Custom terms require both approved percentages."
        });
        return;
      }

      if (value.approvedAgencyPercentage + value.approvedModelPercentage !== 100) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Approved custom percentages must sum 100."
        });
      }
    }
  });

export type NegotiationDecision = z.infer<typeof NegotiationDecisionSchema>;

export const KnowledgeEntrySchema = z.object({
  id: z.string().min(1),
  category: KnowledgeCategorySchema,
  title: z.string().min(1),
  facts: z.array(z.string().min(1)).default([]),
  approvedAnswerPoints: z.array(z.string().min(1)).default([]),
  prohibitedClaims: z.array(z.string().min(1)).default([]),
  mandatoryNuances: z.array(z.string().min(1)).default([]),
  escalationConditions: z.array(z.string().min(1)).default([]),
  allowedStates: z.array(CandidateStateSchema).default([]),
  tags: z.array(z.string().min(1)).default([]),
  requiresHumanReview: z.boolean(),
  version: z.string().min(1),
  status: KnowledgeStatusSchema,
  approvedByAlex: z.boolean(),
  updatedAt: z.string().min(1)
});

export type KnowledgeEntry = z.infer<typeof KnowledgeEntrySchema>;
export type KnowledgeEntryInput = z.input<typeof KnowledgeEntrySchema>;

export const AllowedActionSchema = z.enum([
  "ANSWER_WITH_APPROVED_FACTS",
  "ASK_QUALIFYING_QUESTION",
  "REQUEST_PROFILE_ACCESS",
  "PAUSE_FOR_HUMAN_REVIEW",
  "COLLECT_CALL_DETAILS",
  "CLOSE_CONVERSATION"
]);

export type AllowedAction = z.infer<typeof AllowedActionSchema>;

export const ForbiddenActionSchema = z.enum([
  "INVENT_BUSINESS_POLICY",
  "DISCLOSE_UNCONFIRMED_PERCENTAGE",
  "NEGOTIATE_BY_CHAT",
  "PROMISE_INCOME",
  "INVENT_CONTRACT_TERMS",
  "INVENT_SERVICES",
  "CLAIM_PROFILE_REVIEW_WITHOUT_CONFIRMATION"
]);

export type ForbiddenAction = z.infer<typeof ForbiddenActionSchema>;

export const ResponsePlanSchema = z.object({
  objective: z.string(),
  acknowledgedFacts: z.array(z.string()).default([]),
  answerFacts: z.array(z.string()).default([]),
  knowledgeEntryIds: z.array(z.string()).default([]),
  allowedClaims: z.array(z.string()).default([]),
  prohibitedClaims: z.array(z.string()).default([]),
  mandatoryNuances: z.array(z.string()).default([]),
  questionToAsk: z.string().nullable(),
  requiresHumanReview: z.boolean(),
  humanReviewReason: HumanReviewReasonSchema.nullable(),
  allowedActions: z.array(AllowedActionSchema).default([]),
  forbiddenActions: z.array(ForbiddenActionSchema).default([]),
  uncoveredQuestion: z.boolean().default(false),
  knowledgeVersions: z.array(z.string()).default([]),
  revenueSharePolicyVersion: z.string().nullable(),
  hasApprovedNegotiationDecision: z.boolean().default(false)
});

export type ResponsePlan = z.infer<typeof ResponsePlanSchema>;
