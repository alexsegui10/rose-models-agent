import type { Candidate, CandidatePatch } from "@/domain/candidate";
import type { ExtractedCandidateData } from "./llmProvider";

export interface DataConsistencyResult {
  patch: CandidatePatch;
  contradictions: string[];
  corrections: string[];
}

const correctionPattern = /\b(perdon|perdón|corrijo|en realidad|quise decir|me he equivocado|me equivoque|me equivoqué)\b/i;

export function buildConsistentCandidatePatch(input: {
  candidate: Candidate;
  extractedData: ExtractedCandidateData;
  inboundMessage: string;
}): DataConsistencyResult {
  const patch: CandidatePatch = {};
  const contradictions: string[] = [];
  const corrections: string[] = [];
  const allowsCorrection = correctionPattern.test(input.inboundMessage);

  applyValue("age", input.candidate.age, input.extractedData.age, patch, contradictions, corrections, allowsCorrection);
  if (patch.age !== undefined) patch.isAdultConfirmed = patch.age >= 18;
  applyValue("country", input.candidate.country, input.extractedData.country, patch, contradictions, corrections, allowsCorrection);
  applyValue("city", input.candidate.city, input.extractedData.city, patch, contradictions, corrections, allowsCorrection);
  applyValue("phone", input.candidate.phone, input.extractedData.phone, patch, contradictions, corrections, allowsCorrection);
  applyValue("phoneDeviceType", input.candidate.phoneDeviceType, input.extractedData.phoneDeviceType, patch, contradictions, corrections, allowsCorrection);
  applyValue("hasRequiredIPhone", input.candidate.hasRequiredIPhone, input.extractedData.hasRequiredIPhone, patch, contradictions, corrections, allowsCorrection);
  if (input.extractedData.profileVisibility) {
    patch.declaredProfileVisibility = input.extractedData.profileVisibility;
    patch.profileVisibility = input.extractedData.profileVisibility;
  }
  applyValue("hasOnlyFans", input.candidate.hasOnlyFans, input.extractedData.hasOnlyFans, patch, contradictions, corrections, allowsCorrection);
  applyValue("worksWithAnotherAgency", input.candidate.worksWithAnotherAgency, input.extractedData.worksWithAnotherAgency, patch, contradictions, corrections, allowsCorrection);
  applyValue("currentMonthlyRevenue", input.candidate.currentMonthlyRevenue, input.extractedData.currentMonthlyRevenue, patch, contradictions, corrections, allowsCorrection);
  applyContentAvailability(input.candidate.contentAvailability, input.extractedData.contentAvailability, patch, contradictions, corrections, allowsCorrection);

  if (input.extractedData.firstName && !input.candidate.firstName) patch.firstName = input.extractedData.firstName;
  if (input.extractedData.experienceDescription && !input.candidate.experienceDescription) patch.experienceDescription = input.extractedData.experienceDescription;
  if (input.extractedData.goals && !input.candidate.goals) patch.goals = input.extractedData.goals;
  if (input.extractedData.objections?.length) patch.objections = [...input.candidate.objections, ...input.extractedData.objections];

  return { patch, contradictions, corrections };
}

function applyValue<K extends keyof CandidatePatch>(
  key: K,
  currentValue: CandidatePatch[K],
  nextValue: CandidatePatch[K] | undefined,
  patch: CandidatePatch,
  contradictions: string[],
  corrections: string[],
  allowsCorrection: boolean
): void {
  if (nextValue === undefined) return;

  if (currentValue === undefined || currentValue === null || currentValue === "UNKNOWN" || currentValue === nextValue) {
    patch[key] = nextValue;
    return;
  }

  if (allowsCorrection) {
    patch[key] = nextValue;
    corrections.push(`${String(key)} corrected from ${String(currentValue)} to ${String(nextValue)}`);
    return;
  }

  contradictions.push(`${String(key)} changed from ${String(currentValue)} to ${String(nextValue)}`);
}

function applyContentAvailability(
  currentValue: string | undefined,
  nextValue: string | undefined,
  patch: CandidatePatch,
  contradictions: string[],
  corrections: string[],
  allowsCorrection: boolean
): void {
  if (typeof nextValue !== "string" || nextValue.trim().length === 0) return;
  applyValue("contentAvailability", currentValue, nextValue, patch, contradictions, corrections, allowsCorrection);
}
