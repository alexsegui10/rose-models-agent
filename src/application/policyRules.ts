import {
  CommunicationPolicySchema,
  ContentProductionPolicySchema,
  NegotiationAuthoritySchema,
  NonPaymentPolicySchema,
  type NegotiationLog
} from "@/domain/businessKnowledge";
import type { CandidateCommercialTier, DeviceEligibility, DeviceType } from "@/domain/candidate";

export const negotiationAuthority = NegotiationAuthoritySchema.parse({
  STANDARD: { minimumAgencyPercentage: 70 },
  HIGH_POTENTIAL: { minimumAgencyPercentage: 65 },
  EXCEPTIONAL: { minimumAgencyPercentage: 60 }
});

export const nonPaymentPolicy = NonPaymentPolicySchema.parse({
  gracePeriodDays: 7,
  reminderRequired: true,
  suspendAfterGracePeriod: true,
  terminateAfterContinuedNonPayment: true,
  allowDebtCollection: true,
  grantsUnlimitedContentRights: false
});

export const communicationPolicy = CommunicationPolicySchema.parse({
  expectedResponseTimeHours: 48,
  singleDelayCausesRejection: false,
  repeatedDelaysRequireHumanReview: true
});

export const contentProductionPolicy = ContentProductionPolicySchema.parse({
  warmupDays: 5,
  warmupPhotosPerDayMin: 2,
  warmupPhotosPerDayMax: 3,
  targetReelsPerWeekMin: 10,
  targetReelsPerWeekMax: 20,
  isContractualMinimumConfirmed: false
});

export function minimumAgencyPercentageForTier(tier: CandidateCommercialTier): number {
  return negotiationAuthority[tier].minimumAgencyPercentage;
}

export function canOfferAgencyPercentage(tier: CandidateCommercialTier, agencyPercentage: number): boolean {
  return agencyPercentage >= minimumAgencyPercentageForTier(tier) && agencyPercentage >= 60;
}

export function firstCounterOfferForTier(tier: CandidateCommercialTier): number {
  if (tier === "STANDARD") return 70;
  return 65;
}

export function canUseSixtyFortyAsFirstCounterOffer(): boolean {
  return false;
}

export function createNegotiationLog(input: NegotiationLog): NegotiationLog {
  return input;
}

export function deviceEligibilityForDescription(description: string): DeviceEligibility {
  const normalized = normalize(description);

  if (
    /\b(comprare|compraré|cambiare|cambiaré|me comprare|me compraré|me cambio)\b.*\b(iphone|galaxy\s?s2[3-9]|s23|s24|s25)\b/.test(
      normalized
    )
  )
    return "PENDING_UPGRADE";
  if (/\b(viejo|malo|mala calidad|roto|gama baja|android barato|redmi antiguo)\b/.test(normalized)) return "NOT_ELIGIBLE";
  // (?!\d) en vez de \b: "iphone 13pro max" pega el sufijo al numero y \b no corta entre "13" y "pro".
  if (/\biphone\s?(1[3-9]|[2-9]\d)(?!\d)/.test(normalized)) return "APPROVED";
  if (/\biphone\s?([1-9]|1[0-2])(?!\d)/.test(normalized)) return "PENDING_QUALITY_TEST";
  if (/\b(galaxy\s?s2[3-9]|samsung\s?s2[3-9])\b/.test(normalized)) return "APPROVED";
  if (/\b(pro|max|ultra|gama alta|high end|xiaomi 14|xiaomi 15|pixel 8|pixel 9)\b/.test(normalized))
    return "PENDING_QUALITY_TEST";
  if (/\b(iphone|samsung|galaxy|android|xiaomi|huawei|oppo|realme|pixel)\b/.test(normalized)) return "PENDING_QUALITY_TEST";

  return "UNKNOWN";
}

export function deviceTypeForDescription(description: string): DeviceType {
  const normalized = normalize(description);
  if (/\b(iphone|i phone|ios)\b/.test(normalized)) return "IPHONE";
  if (/\b(samsung|galaxy)\b/.test(normalized)) return "SAMSUNG";
  if (/\b(android|xiaomi|huawei|oppo|realme|pixel|movil|telefono)\b/.test(normalized)) return "OTHER";
  return "UNKNOWN";
}

export function deviceModelForDescription(description: string): string | null {
  const normalized = normalize(description);
  const match = normalized.match(
    /\b(iphone\s?\d{1,2}(?:\s?(?:pro\s?max|pro|max|plus|mini))?|galaxy\s?s\d{2}(?:\s?(?:ultra|plus))?|samsung\s?s\d{2}(?:\s?(?:ultra|plus))?|pixel\s?\d{1,2}\s?pro|pixel\s?\d{1,2}|xiaomi\s?\d{1,2})\b/
  );
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

export function shouldAskCurrentRevenue(hasOnlyFans: boolean | undefined): boolean {
  return hasOnlyFans === true;
}

export function shouldAskFollowerCount(): boolean {
  return false;
}

export function shouldEscalateForCommunicationDelay(delayCount: number): boolean {
  return delayCount > 1;
}

export function followUpAttemptCountRange(): { min: 2; max: 3 } {
  return { min: 2, max: 3 };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
