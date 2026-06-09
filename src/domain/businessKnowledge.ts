import { z } from "zod";
import { CandidateStateSchema, HumanReviewReasonSchema, OnboardingBlockerSchema } from "./candidate";

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

export const KnowledgeStatusSchema = z.enum(["DRAFT", "ACTIVE", "DEPRECATED", "DRAFT_LEGAL_REVIEW_REQUIRED"]);
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
    calculationBasis: z.enum(["NET_AFTER_PLATFORM_COMMISSION"]).optional(),
    platformPayoutRecipient: z.enum(["MODEL"]).optional(),
    paymentMethodToAgency: z.enum(["SKRILL"]).optional(),
    settlementIntervalDays: z.number().int().positive().optional(),
    settlementStartsFromFirstRevenue: z.boolean().optional(),
    alexCalculatesSettlementManually: z.boolean().optional(),
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

export const NegotiationAuthoritySchema = z.object({
  STANDARD: z.object({ minimumAgencyPercentage: z.literal(70) }),
  HIGH_POTENTIAL: z.object({ minimumAgencyPercentage: z.literal(65) }),
  EXCEPTIONAL: z.object({ minimumAgencyPercentage: z.literal(60) })
});
export type NegotiationAuthority = z.infer<typeof NegotiationAuthoritySchema>;

export const NegotiationLogSchema = z.object({
  initialOfferAgencyPercentage: z.number().min(0).max(100),
  objection: z.string().min(1),
  candidateCounterOfferModelPercentage: z.number().min(0).max(100).nullable(),
  offeredAgencyPercentage: z.number().min(0).max(100),
  finalAgencyPercentage: z.number().min(0).max(100).nullable(),
  reductionReason: z.string().min(1)
});
export type NegotiationLog = z.infer<typeof NegotiationLogSchema>;

export const NonPaymentPolicySchema = z.object({
  gracePeriodDays: z.literal(7),
  reminderRequired: z.literal(true),
  suspendAfterGracePeriod: z.literal(true),
  terminateAfterContinuedNonPayment: z.literal(true),
  allowDebtCollection: z.literal(true),
  grantsUnlimitedContentRights: z.literal(false)
});
export type NonPaymentPolicy = z.infer<typeof NonPaymentPolicySchema>;

export const CommunicationPolicySchema = z.object({
  expectedResponseTimeHours: z.literal(48),
  singleDelayCausesRejection: z.literal(false),
  repeatedDelaysRequireHumanReview: z.literal(true)
});
export type CommunicationPolicy = z.infer<typeof CommunicationPolicySchema>;

export const ContentProductionPolicySchema = z.object({
  warmupDays: z.literal(5),
  warmupPhotosPerDayMin: z.literal(2),
  warmupPhotosPerDayMax: z.literal(3),
  targetReelsPerWeekMin: z.literal(10),
  targetReelsPerWeekMax: z.literal(20),
  isContractualMinimumConfirmed: z.literal(false)
});
export type ContentProductionPolicy = z.infer<typeof ContentProductionPolicySchema>;

export const CandidateDeviceRequirementSchema = z.object({
  requiredDevice: z.literal("HIGH_QUALITY_PHONE"),
  isMandatory: z.literal(true),
  mustBeConfirmedBeforeHumanFinalApproval: z.literal(true),
  approvedQuestion: z.string().min(1),
  rejectionOrPausePolicy: z.string().min(1),
  version: z.string().min(1)
});

export type CandidateDeviceRequirement = z.infer<typeof CandidateDeviceRequirementSchema>;

export const QualificationReadinessSchema = z.object({
  readyForHumanReview: z.boolean(),
  readyForCall: z.boolean(),
  readyForOnboarding: z.boolean(),
  isReady: z.boolean(),
  missingRequiredFields: z.array(z.string()).default([]),
  blockingReasons: z.array(z.string()).default([]),
  onboardingBlockers: z.array(OnboardingBlockerSchema).default([])
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
