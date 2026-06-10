import type { Candidate } from "@/domain/candidate";

export function buildCandidatePanelRows(currentCandidate: Candidate | null): Array<[string, string]> {
  if (!currentCandidate) return [];

  return [
    ["Estado", currentCandidate.currentState],
    ["Usuario", currentCandidate.instagramUsername],
    ["Edad", currentCandidate.age?.toString() ?? "-"],
    ["Ciudad", currentCandidate.city ?? "-"],
    ["Pais", currentCandidate.country ?? "-"],
    ["Telefono", currentCandidate.phone ?? "-"],
    ["Tipo dispositivo", currentCandidate.deviceType],
    ["Modelo dispositivo", currentCandidate.deviceModel ?? "-"],
    ["Elegibilidad dispositivo", currentCandidate.deviceEligibility],
    ["Nivel comercial", currentCandidate.commercialTier],
    ["Visibilidad declarada", currentCandidate.declaredProfileVisibility],
    ["Solicitud aceptada declarada", booleanValue(currentCandidate.candidateClaimsFollowRequestAccepted)],
    ["Acceso verificado", booleanValue(currentCandidate.humanVerifiedProfileAccess)],
    ["Revision perfil humano", currentCandidate.humanProfileReviewStatus],
    ["Decision humana", currentCandidate.humanFitDecision],
    ["Bloqueos onboarding", formatOnboardingBlockers(currentCandidate.onboardingBlockers)],
    ["OnlyFans", booleanValue(currentCandidate.hasOnlyFans)],
    ["Otra agencia", booleanValue(currentCandidate.worksWithAnotherAgency)],
    ["Revision humana", currentCandidate.humanReviewStatus]
  ];
}

export function formatOnboardingBlockers(onboardingBlockers?: readonly string[] | null): string {
  return onboardingBlockers?.join(", ") || "-";
}

function booleanValue(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }

  return value ? "Si" : "No";
}
