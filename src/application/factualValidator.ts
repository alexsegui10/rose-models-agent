import { activeRevenueSharePolicy } from "@/content/business";
import type { ResponsePlan } from "@/domain/businessKnowledge";

export interface FactualValidationResult {
  valid: boolean;
  reasons: string[];
  uncoveredInformation: boolean;
}

const forbiddenIncomePatterns = [/ingresos garantizados/i, /ganancias garantizadas/i, /te garantizamos/i, /vas a ganar/i];
const serviceClaims = [
  { pattern: /fotograf/i, label: "fotografia" },
  { pattern: /viajes/i, label: "viajes" },
  { pattern: /asesoramiento legal/i, label: "asesoramiento legal" },
  { pattern: /publicaciones automaticas/i, label: "publicaciones automaticas" }
];

export function validateFactualResponse(response: string, plan: ResponsePlan): FactualValidationResult {
  const reasons: string[] = [];

  if (
    /(?:\d{1,3}\s?%|70\/30)/.test(response) &&
    !plan.hasApprovedNegotiationDecision &&
    (!activeRevenueSharePolicy.isConfirmed || !activeRevenueSharePolicy.canDiscloseExactPercentagesInChat)
  ) {
    reasons.push("La respuesta incluye porcentajes no autorizados para chat.");
  }

  for (const pattern of forbiddenIncomePatterns) {
    if (pattern.test(response)) reasons.push("La respuesta promete ingresos o resultados economicos.");
  }

  if (/contrato|clausula|cláusula|permanencia/i.test(response) && !hasAllowedContractClaim(plan)) {
    reasons.push("La respuesta puede estar inventando condiciones contractuales.");
  }

  for (const service of serviceClaims) {
    if (service.pattern.test(response) && !plan.allowedClaims.some((claim) => claim.toLowerCase().includes(service.label))) {
      reasons.push(`La respuesta menciona un servicio no documentado: ${service.label}.`);
    }
  }

  for (const prohibitedClaim of plan.prohibitedClaims) {
    if (containsLoose(response, prohibitedClaim)) {
      reasons.push(`La respuesta contradice una politica vigente: ${prohibitedClaim}`);
    }
  }

  if (plan.uncoveredQuestion && !/socio|consult/i.test(response)) {
    reasons.push("La pregunta no cubierta debe derivarse a revision humana.");
  }

  return {
    valid: reasons.length === 0,
    reasons,
    uncoveredInformation: plan.uncoveredQuestion
  };
}

export function safeFactualFallback(): string {
  return "Esa parte prefiero comentarla con mi socio para darte la informacion correcta. Se lo consulto y te digo.";
}

function hasAllowedContractClaim(plan: ResponsePlan): boolean {
  return plan.knowledgeEntryIds.includes("contract-questions-human-review");
}

function containsLoose(response: string, claim: string): boolean {
  return response.toLowerCase().includes(claim.toLowerCase());
}
