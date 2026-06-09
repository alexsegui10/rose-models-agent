import type { Candidate, OnboardingBlocker } from "@/domain/candidate";
import { QualificationReadinessSchema, type QualificationReadiness } from "@/domain/businessKnowledge";

export function evaluateQualificationReadiness(candidate: Candidate): QualificationReadiness {
  const missingRequiredFields: string[] = [];
  const blockingReasons: string[] = [];

  if (!candidate.age || !candidate.isAdultConfirmed) missingRequiredFields.push("adultAgeConfirmed");
  if (!candidate.firstName && !candidate.displayName && !candidate.instagramUsername) missingRequiredFields.push("name");
  if (!candidate.country) missingRequiredFields.push("country");
  if (!candidate.experienceDescription && candidate.hasOnlyFans === undefined) missingRequiredFields.push("experienceOrOnlyFans");
  if (!candidate.contentAvailability) missingRequiredFields.push("contentAvailability");
  if (candidate.deviceEligibility === "UNKNOWN") missingRequiredFields.push("deviceKnown");

  if (candidate.declaredProfileVisibility === "PRIVATE" && !candidate.humanVerifiedProfileAccess && candidate.humanProfileReviewStatus === "NOT_REVIEWED") {
    blockingReasons.push("profileAccessNotVerified");
  }

  if (candidate.notes.some((note) => note.startsWith("CONTRADICTION:"))) {
    blockingReasons.push("dataContradiction");
  }

  if (candidate.deviceEligibility === "NOT_ELIGIBLE") {
    blockingReasons.push("deviceNotEligible");
  }

  const readyForHumanReview = missingRequiredFields.length === 0 && blockingReasons.length === 0;
  const readyForCall = readyForHumanReview && candidate.deviceEligibility !== "NOT_ELIGIBLE";
  const onboardingBlockers = onboardingBlockersFor(candidate);
  const readyForOnboarding = readyForCall && onboardingBlockers.length === 0;

  return QualificationReadinessSchema.parse({
    readyForHumanReview,
    readyForCall,
    readyForOnboarding,
    isReady: readyForHumanReview,
    missingRequiredFields,
    blockingReasons,
    onboardingBlockers
  });
}

export function onboardingBlockersFor(candidate: Candidate): OnboardingBlocker[] {
  const blockers: OnboardingBlocker[] = [];

  if (candidate.deviceEligibility === "PENDING_UPGRADE") blockers.push("DEVICE_UPGRADE_REQUIRED");
  if (candidate.deviceEligibility === "PENDING_QUALITY_TEST" || candidate.deviceEligibility === "UNKNOWN") blockers.push("DEVICE_QUALITY_TEST_REQUIRED");
  blockers.push("IDENTITY_VERIFICATION_REQUIRED", "CONTRACT_REQUIRED");

  return blockers;
}
