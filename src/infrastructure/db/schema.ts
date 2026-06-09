import { boolean, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const candidateStateEnum = pgEnum("candidate_state", [
  "NEW_LEAD",
  "WAITING_PROFILE_ACCESS",
  "PROFILE_READY_FOR_REVIEW",
  "QUALIFYING",
  "WAITING_HUMAN_REVIEW",
  "APPROVED",
  "REJECTED",
  "COLLECTING_CALL_DETAILS",
  "READY_TO_SCHEDULE",
  "CALL_SCHEDULED",
  "HUMAN_INTERVENTION_REQUIRED",
  "CLOSED"
]);

export const profileVisibilityEnum = pgEnum("profile_visibility", ["PUBLIC", "PRIVATE", "UNKNOWN"]);
export const humanReviewStatusEnum = pgEnum("human_review_status", [
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MORE_INFO_REQUESTED",
  "TAKEN_OVER"
]);
export const conversationRoleEnum = pgEnum("conversation_role", ["candidate", "agent", "alex", "system"]);
export const conversationAuthorEnum = pgEnum("conversation_author", ["CANDIDATE", "AI_AGENT", "ALEX", "TEAM_MEMBER", "SYSTEM"]);
export const humanFitDecisionEnum = pgEnum("human_fit_decision", ["PENDING", "APPROVED", "REJECTED"]);
export const humanProfileReviewStatusEnum = pgEnum("human_profile_review_status", ["NOT_REVIEWED", "POTENTIAL_FIT", "NOT_A_FIT"]);
export const deviceTypeEnum = pgEnum("device_type", ["IPHONE", "SAMSUNG", "OTHER", "UNKNOWN"]);
export const deviceEligibilityEnum = pgEnum("device_eligibility", ["APPROVED", "PENDING_QUALITY_TEST", "PENDING_UPGRADE", "NOT_ELIGIBLE", "UNKNOWN"]);
export const candidateCommercialTierEnum = pgEnum("candidate_commercial_tier", ["STANDARD", "HIGH_POTENTIAL", "EXCEPTIONAL"]);
export const onboardingBlockerEnum = pgEnum("onboarding_blocker", ["DEVICE_UPGRADE_REQUIRED", "DEVICE_QUALITY_TEST_REQUIRED", "IDENTITY_VERIFICATION_REQUIRED", "CONTRACT_REQUIRED"]);
export const humanReviewReasonEnum = pgEnum("human_review_reason", ["PROFILE_REVIEW", "PERCENTAGE_NEGOTIATION", "COMMERCIAL_EXCEPTION", "CONTRACT_QUESTION", "DATA_CONTRADICTION", "OTHER"]);
export const negotiationDecisionEnum = pgEnum("negotiation_decision", ["KEEP_STANDARD_TERMS", "ALLOW_CUSTOM_TERMS", "REJECT_NEGOTIATION", "DISCUSS_IN_CALL"]);
export const conversationFeedbackStatusEnum = pgEnum("conversation_feedback_status", ["APPROVED", "EDITED", "REJECTED"]);

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  instagramUsername: text("instagram_username").notNull().unique(),
  displayName: text("display_name"),
  firstName: text("first_name"),
  age: integer("age"),
  isAdultConfirmed: boolean("is_adult_confirmed").notNull().default(false),
  country: text("country"),
  city: text("city"),
  phone: text("phone"),
  deviceType: deviceTypeEnum("device_type").notNull().default("UNKNOWN"),
  deviceModel: text("device_model"),
  deviceEligibility: deviceEligibilityEnum("device_eligibility").notNull().default("UNKNOWN"),
  commercialTier: candidateCommercialTierEnum("commercial_tier").notNull().default("STANDARD"),
  declaredProfileVisibility: profileVisibilityEnum("declared_profile_visibility").notNull().default("UNKNOWN"),
  candidateClaimsFollowRequestAccepted: boolean("candidate_claims_follow_request_accepted").notNull().default(false),
  humanVerifiedProfileAccess: boolean("human_verified_profile_access").notNull().default(false),
  humanProfileReviewStatus: humanProfileReviewStatusEnum("human_profile_review_status").notNull().default("NOT_REVIEWED"),
  humanFitDecision: humanFitDecisionEnum("human_fit_decision").notNull().default("PENDING"),
  hasOnlyFans: boolean("has_only_fans"),
  worksWithAnotherAgency: boolean("works_with_another_agency"),
  experienceDescription: text("experience_description"),
  currentMonthlyRevenue: integer("current_monthly_revenue"),
  contentAvailability: text("content_availability"),
  goals: text("goals"),
  interestLevel: text("interest_level").notNull().default("UNKNOWN"),
  objections: jsonb("objections").$type<string[]>().notNull().default([]),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  conversationSummary: text("conversation_summary").notNull().default(""),
  currentState: candidateStateEnum("current_state").notNull().default("NEW_LEAD"),
  humanReviewStatus: humanReviewStatusEnum("human_review_status").notNull().default("NOT_REQUIRED"),
  humanReviewReason: humanReviewReasonEnum("human_review_reason"),
  onboardingBlockers: jsonb("onboarding_blockers").$type<string[]>().notNull().default([]),
  automationPaused: boolean("automation_paused").notNull().default(false),
  manualControlActive: boolean("manual_control_active").notNull().default(false),
  generationCancellationVersion: integer("generation_cancellation_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
});

export const conversationMessages = pgTable("conversation_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  role: conversationRoleEnum("role").notNull(),
  author: conversationAuthorEnum("author").notNull(),
  content: text("content").notNull(),
  externalMessageId: text("external_message_id"),
  metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const stateTransitions = pgTable("state_transitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  fromState: candidateStateEnum("from_state").notNull(),
  toState: candidateStateEnum("to_state").notNull(),
  trigger: text("trigger").notNull(),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const conversationFeedback = pgTable("conversation_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  candidateId: uuid("candidate_id").notNull(),
  messageId: uuid("message_id"),
  status: conversationFeedbackStatusEnum("status").notNull(),
  originalResponse: text("original_response").notNull(),
  editedResponse: text("edited_response"),
  reason: text("reason"),
  state: candidateStateEnum("state").notNull(),
  contextSnapshot: text("context_snapshot").notNull(),
  styleProfileVersion: text("style_profile_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  modelVersion: text("model_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});

export const approvedResponses = pgTable("approved_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  feedbackId: uuid("feedback_id").notNull(),
  response: text("response").notNull(),
  state: candidateStateEnum("state").notNull(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  styleProfileVersion: text("style_profile_version").notNull(),
  promptVersion: text("prompt_version").notNull(),
  modelVersion: text("model_version").notNull(),
  approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow()
});

export const negotiationDecisions = pgTable("negotiation_decisions", {
  candidateId: uuid("candidate_id").primaryKey(),
  requestedModelPercentage: numeric("requested_model_percentage"),
  currentPolicyAgencyPercentage: numeric("current_policy_agency_percentage"),
  currentPolicyModelPercentage: numeric("current_policy_model_percentage"),
  decision: negotiationDecisionEnum("decision").notNull(),
  approvedAgencyPercentage: numeric("approved_agency_percentage"),
  approvedModelPercentage: numeric("approved_model_percentage"),
  reason: text("reason").notNull(),
  decidedBy: text("decided_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
});
