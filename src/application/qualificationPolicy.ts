import type { Candidate } from "@/domain/candidate";
import { QualificationReadinessSchema, type QualificationReadiness } from "@/domain/businessKnowledge";

export function evaluateQualificationReadiness(candidate: Candidate): QualificationReadiness {
  const missingRequiredFields: string[] = [];
  const blockingReasons: string[] = [];

  if (!candidate.age || !candidate.isAdultConfirmed) missingRequiredFields.push("adultAgeConfirmed");
  if (!candidate.firstName && !candidate.displayName && !candidate.instagramUsername) missingRequiredFields.push("name");
  if (!candidate.country) missingRequiredFields.push("country");
  if (!candidate.experienceDescription && candidate.hasOnlyFans === undefined) missingRequiredFields.push("experienceOrOnlyFans");
  if (!candidate.contentAvailability) missingRequiredFields.push("contentAvailability");
  if (candidate.hasRequiredIPhone !== true) missingRequiredFields.push("hasRequiredIPhone");

  if (candidate.declaredProfileVisibility === "PRIVATE" && !candidate.humanVerifiedProfileAccess && !candidate.humanProfileReviewed) {
    blockingReasons.push("profileAccessNotVerified");
  }

  if (candidate.notes.some((note) => note.startsWith("CONTRADICTION:"))) {
    blockingReasons.push("dataContradiction");
  }

  if (candidate.hasRequiredIPhone === false) {
    blockingReasons.push("missingMandatoryIPhone");
  }

  return QualificationReadinessSchema.parse({
    isReady: missingRequiredFields.length === 0 && blockingReasons.length === 0,
    missingRequiredFields,
    blockingReasons
  });
}
