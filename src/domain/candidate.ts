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

export const ProfileVisibilitySchema = z.enum(["PUBLIC", "PRIVATE", "UNKNOWN"]);
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

export const HumanProfileReviewStatusSchema = z.enum(["NOT_REVIEWED", "POTENTIAL_FIT", "NOT_A_FIT"]);
export type HumanProfileReviewStatus = z.infer<typeof HumanProfileReviewStatusSchema>;

export const HumanFitDecisionSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
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

export const DeviceTypeSchema = z.enum(["IPHONE", "SAMSUNG", "OTHER", "UNKNOWN"]);
export type DeviceType = z.infer<typeof DeviceTypeSchema>;

export const DeviceEligibilitySchema = z.enum(["APPROVED", "PENDING_QUALITY_TEST", "PENDING_UPGRADE", "NOT_ELIGIBLE", "UNKNOWN"]);
export type DeviceEligibility = z.infer<typeof DeviceEligibilitySchema>;

export const CandidateCommercialTierSchema = z.enum(["STANDARD", "HIGH_POTENTIAL", "EXCEPTIONAL"]);
export type CandidateCommercialTier = z.infer<typeof CandidateCommercialTierSchema>;

export const OnboardingBlockerSchema = z.enum([
  "DEVICE_UPGRADE_REQUIRED",
  "DEVICE_QUALITY_TEST_REQUIRED",
  "IDENTITY_VERIFICATION_REQUIRED",
  "CONTRACT_REQUIRED"
]);
export type OnboardingBlocker = z.infer<typeof OnboardingBlockerSchema>;

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
  deviceType: DeviceTypeSchema.default("UNKNOWN"),
  deviceModel: z.string().nullable().default(null),
  deviceEligibility: DeviceEligibilitySchema.default("UNKNOWN"),
  commercialTier: CandidateCommercialTierSchema.default("STANDARD"),
  declaredProfileVisibility: ProfileVisibilitySchema.default("UNKNOWN"),
  candidateClaimsFollowRequestAccepted: z.boolean().default(false),
  humanVerifiedProfileAccess: z.boolean().default(false),
  humanProfileReviewStatus: HumanProfileReviewStatusSchema.default("NOT_REVIEWED"),
  humanFitDecision: HumanFitDecisionSchema.default("PENDING"),
  hasOnlyFans: z.boolean().optional(),
  worksWithAnotherAgency: z.boolean().optional(),
  experienceDescription: z.string().optional(),
  currentMonthlyRevenue: z.number().nonnegative().optional(),
  contentAvailability: z.string().optional(),
  goals: z.string().optional(),
  interestLevel: InterestLevelSchema.default("UNKNOWN"),
  objections: z.array(z.string()).default([]),
  // Cuantas veces la candidata ha objetado/dudado de mostrar la cara. La 1a vez se reconduce; si
  // insiste se cierra educadamente (peticion de Alex: no rechazar de golpe). Nunca debilita el
  // invariante de "la cara es imprescindible", solo controla el RITMO del rechazo.
  faceObjectionCount: z.number().int().nonnegative().default(0),
  notes: z.array(z.string()).default([]),
  conversationSummary: z.string().default(""),
  currentState: CandidateStateSchema.default("NEW_LEAD"),
  humanReviewStatus: HumanReviewStatusSchema.default("NOT_REQUIRED"),
  humanReviewReason: HumanReviewReasonSchema.optional(),
  onboardingBlockers: z.array(OnboardingBlockerSchema).default([]),
  automationPaused: z.boolean().default(false),
  manualControlActive: z.boolean().default(false),
  generationCancellationVersion: z.number().int().nonnegative().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
  lastMessageAt: z.date().optional()
});

export type Candidate = z.infer<typeof CandidateSchema>;

type CandidateDateField = "createdAt" | "updatedAt" | "lastMessageAt";

export type CandidateNormalizationInput = Partial<Omit<Candidate, CandidateDateField | "humanFitDecision">> & {
  createdAt?: Date | string;
  updatedAt?: Date | string;
  lastMessageAt?: Date | string;
  humanFitDecision?: unknown;
  profileVisibility?: ProfileVisibility;
  candidateDeclaredProfileAccessAccepted?: boolean;
  profileReviewed?: boolean;
};

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
  deviceType?: DeviceType;
  deviceModel?: string | null;
  deviceEligibility?: z.infer<typeof DeviceEligibilitySchema>;
  commercialTier?: z.infer<typeof CandidateCommercialTierSchema>;
  declaredProfileVisibility?: ProfileVisibility;
  candidateClaimsFollowRequestAccepted?: boolean;
  humanVerifiedProfileAccess?: boolean;
  humanProfileReviewStatus?: HumanProfileReviewStatus;
  humanFitDecision?: HumanFitDecision;
  hasOnlyFans?: boolean;
  worksWithAnotherAgency?: boolean;
  experienceDescription?: string;
  currentMonthlyRevenue?: number;
  contentAvailability?: string;
  goals?: string;
  interestLevel?: InterestLevel;
  objections?: string[];
  faceObjectionCount?: number;
  notes?: string[];
  conversationSummary?: string;
  currentState?: CandidateState;
  humanReviewStatus?: HumanReviewStatus;
  humanReviewReason?: HumanReviewReason;
  onboardingBlockers?: OnboardingBlocker[];
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
    deviceType: "UNKNOWN",
    deviceModel: null,
    deviceEligibility: "UNKNOWN",
    commercialTier: "STANDARD",
    declaredProfileVisibility: input.profileVisibility ?? "UNKNOWN",
    candidateClaimsFollowRequestAccepted: false,
    humanVerifiedProfileAccess: false,
    isAdultConfirmed: false,
    humanProfileReviewStatus: "NOT_REVIEWED",
    humanFitDecision: "PENDING",
    objections: [],
    faceObjectionCount: 0,
    notes: [],
    conversationSummary: "",
    currentState: "NEW_LEAD",
    humanReviewStatus: "NOT_REQUIRED",
    onboardingBlockers: [],
    interestLevel: "UNKNOWN",
    automationPaused: false,
    manualControlActive: false,
    generationCancellationVersion: 0,
    createdAt: now,
    updatedAt: now
  });
}

export function normalizeCandidate(candidate: CandidateNormalizationInput): Candidate {
  const now = new Date();
  const createdAt = normalizeDate(candidate.createdAt, now);
  const updatedAt = normalizeDate(candidate.updatedAt, createdAt);
  const lastMessageAt = normalizeOptionalDate(candidate.lastMessageAt);
  const humanFitDecision = HumanFitDecisionSchema.safeParse(candidate.humanFitDecision);

  return CandidateSchema.parse({
    ...candidate,
    declaredProfileVisibility: candidate.declaredProfileVisibility ?? candidate.profileVisibility ?? "UNKNOWN",
    candidateClaimsFollowRequestAccepted:
      candidate.candidateClaimsFollowRequestAccepted ?? candidate.candidateDeclaredProfileAccessAccepted ?? false,
    humanProfileReviewStatus:
      candidate.humanProfileReviewStatus ?? (candidate.profileReviewed ? "POTENTIAL_FIT" : "NOT_REVIEWED"),
    humanFitDecision: humanFitDecision.success ? humanFitDecision.data : "PENDING",
    deviceType: candidate.deviceType ?? "UNKNOWN",
    deviceModel: candidate.deviceModel ?? null,
    deviceEligibility: candidate.deviceEligibility ?? "UNKNOWN",
    commercialTier: candidate.commercialTier ?? "STANDARD",
    objections: candidate.objections ?? [],
    faceObjectionCount: candidate.faceObjectionCount ?? 0,
    notes: candidate.notes ?? [],
    conversationSummary: candidate.conversationSummary ?? "",
    interestLevel: candidate.interestLevel ?? "UNKNOWN",
    humanReviewStatus: candidate.humanReviewStatus ?? "NOT_REQUIRED",
    onboardingBlockers: candidate.onboardingBlockers ?? [],
    automationPaused: candidate.automationPaused ?? false,
    manualControlActive: candidate.manualControlActive ?? false,
    generationCancellationVersion: candidate.generationCancellationVersion ?? 0,
    createdAt,
    updatedAt,
    lastMessageAt
  });
}

function normalizeDate(value: Date | string | undefined, fallback: Date): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsedDate = new Date(value);
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate;
    }
  }

  return fallback;
}

function normalizeOptionalDate(value: Date | string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsedDate = normalizeDate(value, new Date(Number.NaN));
  return Number.isNaN(parsedDate.getTime()) ? undefined : parsedDate;
}
