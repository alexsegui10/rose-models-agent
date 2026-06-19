import { activeRevenueSharePolicy } from "@/content/business";
import type { ResponsePlan } from "@/domain/businessKnowledge";

export interface FactualValidationResult {
  valid: boolean;
  reasons: string[];
  uncoveredInformation: boolean;
}

const forbiddenIncomePatterns = [/ingresos garantizados/i, /ganancias garantizadas/i, /te garantizamos/i, /vas a ganar/i];
// Importe de pago/salario (400usd, 600 euros, $500, 500 dolares...): el bot NUNCA da cifras de pago de
// forma proactiva. Los detalles de pago van a la llamada y el % solo se da si preguntan la cifra exacta
// (filterCommercialAnswerFacts). Esto caza el importe pelado que forbiddenIncomePatterns no veia (sin la
// palabra "garantizado"), justo donde Alex respondio mal en la realidad (400/800usd). Ancla en la moneda
// para no confundir un modelo de movil o una hora con dinero.
const forbiddenMoneyPattern =
  /\d[\d.,]*\s?(?:usd|u\$s|d[oó]lar(?:es)?|euros?|eur|€|\$)|(?:usd|u\$s|d[oó]lar(?:es)?|euros?|eur|€|\$)\s?\d/i;
const serviceClaims = [
  { pattern: /fotograf/i, label: "fotografia" },
  { pattern: /viajes/i, label: "viajes" },
  { pattern: /asesoramiento legal/i, label: "asesoramiento legal" },
  { pattern: /publicaciones automaticas/i, label: "publicaciones automaticas" }
];

export function validateFactualResponse(response: string, plan: ResponsePlan): FactualValidationResult {
  const reasons: string[] = [];

  // Invariante 3 (ultima linea de defensa): un porcentaje SOLO es legitimo si el PLAN lo autorizo este
  // turno (la candidata pidio la cifra exacta -> filterCommercialAnswerFacts deja el 70/30 en el plan) o
  // hay negociacion aprobada. Si la respuesta menciona un % que el plan NO trae (mencion proactiva o
  // cifra alucinada por OpenAI fuera de answerFacts), se bloquea. Antes esta guarda era inerte porque
  // dependia de la politica (isConfirmed=true), no del plan del turno.
  if (/(?:\d{1,3}\s?%|70\/30)/.test(response) && !plan.hasApprovedNegotiationDecision && !planAuthorizesPercentage(plan)) {
    reasons.push("La respuesta menciona porcentajes que el plan no autorizo este turno (mencion proactiva o alucinada).");
  }

  if (/(?:\d{1,3}\s?%)/.test(response) && !plan.hasApprovedNegotiationDecision) {
    const percentages = [...response.matchAll(/(\d{1,3})\s?%/g)].map((match) => Number(match[1]));
    const allowed = [activeRevenueSharePolicy.agencyPercentage, activeRevenueSharePolicy.modelPercentage].filter(
      (value): value is number => typeof value === "number"
    );
    if (percentages.some((percentage) => !allowed.includes(percentage))) {
      reasons.push("La respuesta incluye porcentajes fuera de la politica aprobada.");
    }
  }

  for (const pattern of forbiddenIncomePatterns) {
    if (pattern.test(response)) reasons.push("La respuesta promete ingresos o resultados economicos.");
  }

  if (forbiddenMoneyPattern.test(response)) {
    reasons.push("La respuesta menciona un importe de pago/salario no autorizado (los importes van a la llamada).");
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

  // Guard semantico de la politica de cara (invariante de negocio innegociable). Los prohibitedClaims
  // de la entrada de cara DESCRIBEN la conducta prohibida ("Prometer difuminar, tapar o recortar la
  // cara como alternativa"), no son frases que el modelo vaya a copiar literalmente, asi que el
  // containsLoose nunca cazaba la violacion real de replay-4 T12 ("para que no salga tu cara").
  // Cuando la entrada de cara esta en juego, una promesa de ocultar/difuminar la cara o de trabajar
  // en anonimato contradice "la cara es imprescindible" y debe fallar la validacion factual.
  if (facePolicyInPlay(plan) && promisesFaceConcealment(response)) {
    reasons.push("La respuesta contradice la politica de cara imprescindible (promete ocultar la cara o anonimato).");
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
  return "Eso dejame que lo hable con mi socio y te digo.";
}

function hasAllowedContractClaim(plan: ResponsePlan): boolean {
  return plan.knowledgeEntryIds.includes("contract-questions-human-review");
}

/**
 * El plan autoriza mencionar un porcentaje SOLO si la cifra esta entre los hechos/afirmaciones que el
 * planner dejo pasar este turno (sucede cuando la candidata pidio la cifra exacta; en otro caso
 * filterCommercialAnswerFacts elimina el 70/30). Asi el validador distingue una cifra legitima de una
 * proactiva/alucinada sin depender de la politica global (que siempre esta "confirmada").
 */
function planAuthorizesPercentage(plan: ResponsePlan): boolean {
  const mentionsPercentage = (text: string) => /\b\d{1,3}\s?%|70\/30\b/.test(text);
  return (
    plan.allowedClaims.some(mentionsPercentage) ||
    plan.answerFacts.some(mentionsPercentage) ||
    plan.acknowledgedFacts.some(mentionsPercentage)
  );
}

function containsLoose(response: string, claim: string): boolean {
  return response.toLowerCase().includes(claim.toLowerCase());
}

function facePolicyInPlay(plan: ResponsePlan): boolean {
  return (
    plan.knowledgeEntryIds.includes("face-requirement-mandatory") ||
    plan.prohibitedClaims.some((claim) => /cara/i.test(claim) && /(difuminar|anonim|recortar|tapar)/i.test(claim))
  );
}

/**
 * Detecta una promesa de ocultar la cara o trabajar en anonimato, sea cual sea la formulacion exacta
 * del modelo: "para que no salga tu cara", "sin mostrar la cara", "difuminamos tu cara", "anonimato".
 */
function promisesFaceConcealment(response: string): boolean {
  const normalized = response
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  if (/\banonimat[oa]\b/.test(normalized)) return true;
  if (
    /\b(difumin|pixel|tap(?:ar|amos)|recort|oscurec|borr(?:ar|amos)|ocult(?:ar|amos))\w*\b[^.!?]{0,30}\bcara\b/.test(normalized)
  ) {
    return true;
  }
  if (/\bcara\b[^.!?]{0,30}\b(difumin|pixel|tapad|recortad|oscurecid|borrad|ocult)\w*/.test(normalized)) return true;
  // Promesas de que la cara no aparece / no se ve / no hace falta mostrarla.
  if (/\b(no\s+(?:saldra|sale|salga|aparece|aparecera|se\s+ve|se\s+vera))\b[^.!?]{0,20}\bcara\b/.test(normalized)) return true;
  if (/\bcara\b[^.!?]{0,20}\bno\s+(?:saldra|sale|salga|aparece|aparecera|se\s+ve|se\s+vera)\b/.test(normalized)) return true;
  if (/\bsin\s+(?:mostrar|ensenar|que\s+se\s+vea)\b[^.!?]{0,15}\bcara\b/.test(normalized)) return true;
  // Formulaciones largas con "sin que (aparezca|salga|se vea) ... la cara" ("sin que aparezca de
  // manera evidente la cara"): el ocultamiento y "cara" pueden ir separados por varias palabras.
  if (/\bsin\s+que\s+(?:aparezca|aparezcan|salga|salgan|se\s+vea|se\s+vean)\b[^.!?]{0,40}\bcara\b/.test(normalized)) return true;
  if (/\bno\s+(?:hace\s+falta|necesitas|tienes\s+que)\s+(?:mostrar|ensenar)\b[^.!?]{0,15}\bcara\b/.test(normalized)) return true;

  return false;
}
