import { z } from "zod";

export const CandidateStateSchema = z.enum([
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

export type CandidateState = z.infer<typeof CandidateStateSchema>;

export const ProfileVisibilitySchema = z.enum(["UNKNOWN", "PUBLIC", "PRIVATE", "UNAVAILABLE"]);
export type ProfileVisibility = z.infer<typeof ProfileVisibilitySchema>;

export const HumanReviewStatusSchema = z.enum([
  "NOT_REQUIRED",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "MORE_INFO_REQUESTED",
  "TAKEN_OVER"
]);
export type HumanReviewStatus = z.infer<typeof HumanReviewStatusSchema>;

export const HumanFitDecisionSchema = z.enum(["UNKNOWN", "PENDING", "APPROVED", "REJECTED", "REQUEST_MORE_INFO", "TAKE_OVER"]);
export type HumanFitDecision = z.infer<typeof HumanFitDecisionSchema>;

export const HumanReviewReasonSchema = z.enum([
  "PROFILE_REVIEW",
  "PERCENTAGE_NEGOTIATION",
  "COMMERCIAL_EXCEPTION",
  "CONTRACT_QUESTION",
  "DATA_CONTRADICTION",
  "OTHER"
]);
export type HumanReviewReason = z.infer<typeof HumanReviewReasonSchema>;

export const InterestLevelSchema = z.enum(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]);
export type InterestLevel = z.infer<typeof InterestLevelSchema>;

export const PhoneDeviceTypeSchema = z.enum(["IPHONE", "ANDROID", "OTHER", "UNKNOWN"]);
export type PhoneDeviceType = z.infer<typeof PhoneDeviceTypeSchema>;

export const CandidateSchema = z.object({
  id: z.string(),
  instagramUsername: z.string().min(1),
  displayName: z.string().optional(),
  firstName: z.string().optional(),
  age: z.number().int().positive().optional(),
  isAdultConfirmed: z.boolean().default(false),
  country: z.string().optional(),
  city: z.string().optional(),
  phone: z.string().optional(),
  phoneDeviceType: PhoneDeviceTypeSchema.default("UNKNOWN"),
  hasRequiredIPhone: z.boolean().nullable().default(null),
  profileVisibility: ProfileVisibilitySchema.default("UNKNOWN"),
  declaredProfileVisibility: ProfileVisibilitySchema.default("UNKNOWN"),
  candidateDeclaredProfileAccessAccepted: z.boolean().default(false),
  humanVerifiedProfileAccess: z.boolean().default(false),
  profileReviewed: z.boolean().default(false),
  humanProfileReviewed: z.boolean().default(false),
  humanFitDecision: HumanFitDecisionSchema.default("UNKNOWN"),
  hasOnlyFans: z.boolean().optional(),
  worksWithAnotherAgency: z.boolean().optional(),
  experienceDescription: z.string().optional(),
  currentMonthlyRevenue: z.number().nonnegative().optional(),
  contentAvailability: z.string().optional(),
  goals: z.string().optional(),
  interestLevel: InterestLevelSchema.default("UNKNOWN"),
  objections: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
  conversationSummary: z.string().default(""),
  currentState: CandidateStateSchema.default("NEW_LEAD"),
  humanReviewStatus: HumanReviewStatusSchema.default("NOT_REQUIRED"),
  humanReviewReason: HumanReviewReasonSchema.optional(),
  automationPaused: z.boolean().default(false),
  manualControlActive: z.boolean().default(false),
  generationCancellationVersion: z.number().int().nonnegative().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastMessageAt: z.date().optional()
});

export type Candidate = z.infer<typeof CandidateSchema>;

export const ConversationRoleSchema = z.enum(["candidate", "agent", "alex", "system"]);
export type ConversationRole = z.infer<typeof ConversationRoleSchema>;

export const ConversationAuthorSchema = z.enum(["CANDIDATE", "AI_AGENT", "ALEX", "TEAM_MEMBER", "SYSTEM"]);
export type ConversationAuthor = z.infer<typeof ConversationAuthorSchema>;

export interface ConversationMessage {
  id: string;
  candidateId: string;
  role: ConversationRole;
  author: ConversationAuthor;
  content: string;
  externalMessageId?: string;
  createdAt: Date;
  metadata?: Record<string, string | number | boolean>;
}

export interface StateTransition {
  id: string;
  candidateId: string;
  fromState: CandidateState;
  toState: CandidateState;
  trigger: string;
  reason: string;
  createdAt: Date;
}

export interface CandidatePatch {
  displayName?: string;
  firstName?: string;
  age?: number;
  isAdultConfirmed?: boolean;
  country?: string;
  city?: string;
  phone?: string;
  phoneDeviceType?: PhoneDeviceType;
  hasRequiredIPhone?: boolean | null;
  profileVisibility?: ProfileVisibility;
  declaredProfileVisibility?: ProfileVisibility;
  candidateDeclaredProfileAccessAccepted?: boolean;
  humanVerifiedProfileAccess?: boolean;
  profileReviewed?: boolean;
  humanProfileReviewed?: boolean;
  humanFitDecision?: HumanFitDecision;
  hasOnlyFans?: boolean;
  worksWithAnotherAgency?: boolean;
  experienceDescription?: string;
  currentMonthlyRevenue?: number;
  contentAvailability?: string;
  goals?: string;
  interestLevel?: InterestLevel;
  objections?: string[];
  notes?: string[];
  conversationSummary?: string;
  currentState?: CandidateState;
  humanReviewStatus?: HumanReviewStatus;
  humanReviewReason?: HumanReviewReason;
  automationPaused?: boolean;
  manualControlActive?: boolean;
  generationCancellationVersion?: number;
  lastMessageAt?: Date;
}

export function createCandidate(input: {
  instagramUsername: string;
  displayName?: string;
  profileVisibility?: ProfileVisibility;
}): Candidate {
  const now = new Date();

  return CandidateSchema.parse({
    id: crypto.randomUUID(),
    instagramUsername: input.instagramUsername,
    displayName: input.displayName,
    profileVisibility: input.profileVisibility ?? "UNKNOWN",
    phoneDeviceType: "UNKNOWN",
    hasRequiredIPhone: null,
    declaredProfileVisibility: input.profileVisibility ?? "UNKNOWN",
    candidateDeclaredProfileAccessAccepted: false,
    humanVerifiedProfileAccess: false,
    isAdultConfirmed: false,
    profileReviewed: false,
    humanProfileReviewed: false,
    humanFitDecision: "UNKNOWN",
    objections: [],
    notes: [],
    conversationSummary: "",
    currentState: "NEW_LEAD",
    humanReviewStatus: "NOT_REQUIRED",
    interestLevel: "UNKNOWN",
    automationPaused: false,
    manualControlActive: false,
    generationCancellationVersion: 0,
    createdAt: now,
    updatedAt: now
  });
}
