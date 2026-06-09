import type { ConversationUnderstandingInput, ConversationUnderstandingProvider, ModelConversationOutput } from "./llmProvider";
import { deviceEligibilityForDescription, deviceModelForDescription, deviceTypeForDescription } from "./policyRules";

const phonePattern = /(?:\+34\s?)?(?:6|7|8|9)\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/;
const agePattern = /\b(?:(?:tengo|edad)\s+(\d{1,2})|(\d{1,2})\s*(?:anos|años|a\b))/i;

export class DeterministicUnderstandingProvider implements ConversationUnderstandingProvider {
  async understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput> {
    return extractDeterministicUnderstanding(input.inboundMessage);
  }
}

export function extractDeterministicUnderstanding(message: string): ModelConversationOutput {
  const normalized = normalize(message);
  const extractedData: ModelConversationOutput["extractedData"] = {};
  const internalNotes: string[] = [];

  const phoneMatch = normalized.match(phonePattern);
  if (phoneMatch) extractedData.phone = phoneMatch[0].replace(/[\s.-]/g, "");

  const deviceEligibility = deviceEligibilityForDescription(normalized);
  if (deviceEligibility !== "UNKNOWN") extractedData.deviceEligibility = deviceEligibility;
  const deviceType = deviceTypeForDescription(normalized);
  if (deviceType !== "UNKNOWN") extractedData.deviceType = deviceType;
  const deviceModel = deviceModelForDescription(normalized);
  if (deviceModel) extractedData.deviceModel = deviceModel;

  if (/\b(iphone|i phone|ios)\b/.test(normalized)) {
    extractedData.deviceType = "IPHONE";
  }

  if (/\b(android|samsung|xiaomi|huawei|oppo|realme|pixel|galaxy)\b/.test(normalized)) {
    extractedData.deviceType = /\b(samsung|galaxy)\b/.test(normalized) ? "SAMSUNG" : "OTHER";
  }

  if (/\b(no tengo iphone|no tengo i phone)\b/.test(normalized)) {
    extractedData.deviceType = deviceType === "UNKNOWN" ? "OTHER" : deviceType;
    extractedData.deviceEligibility = deviceEligibility === "UNKNOWN" ? "PENDING_QUALITY_TEST" : deviceEligibility;
  }

  if (/\b(comprare|compraré|cambiare|cambiaré|me comprare|me compraré|me cambio)\b.*\b(iphone|i phone|galaxy|s23|s24|s25)\b/.test(normalized)) {
    extractedData.deviceType = "UNKNOWN";
    extractedData.deviceEligibility = "PENDING_UPGRADE";
    extractedData.objections = [...(extractedData.objections ?? []), "Tiene pensado comprar un dispositivo valido pronto."];
  }

  const ageMatch = normalized.match(agePattern);
  if (ageMatch) extractedData.age = Number(ageMatch[1] ?? ageMatch[2]);

  if (mentionsPrivateProfile(normalized)) extractedData.profileVisibility = "PRIVATE";

  if (/\b(madrid|barcelona|valencia|sevilla|malaga|alicante|bilbao|murcia|argentina|buenos aires|cordoba|rosario)\b/.test(normalized)) {
    const location = normalized.match(/\b(madrid|barcelona|valencia|sevilla|malaga|alicante|bilbao|murcia|argentina|buenos aires|cordoba|rosario)\b/)?.[0] ?? "";
    if (["argentina", "buenos aires", "cordoba", "rosario"].includes(location)) {
      extractedData.country = "Argentina";
      if (location !== "argentina") extractedData.city = titleCase(location);
    } else {
      extractedData.city = titleCase(location);
      extractedData.country = "España";
    }
  }

  if (/\b(onlyfans|of)\b/.test(normalized)) extractedData.hasOnlyFans = true;
  if (/\b(no tengo onlyfans|sin onlyfans|no tengo of)\b/.test(normalized)) extractedData.hasOnlyFans = false;

  if (/\b(otra agencia|agencia actual|trabajo con agencia|tengo agencia)\b/.test(normalized)) extractedData.worksWithAnotherAgency = true;
  if (/\b(no trabajo con otra agencia|no tengo agencia|sin agencia)\b/.test(normalized)) extractedData.worksWithAnotherAgency = false;

  const revenueMatch = normalized.match(/\b(?:ingreso|ingresos|facturo|gano)\s*(?:unos|sobre)?\s*(\d{3,6})\b/);
  if (revenueMatch) extractedData.currentMonthlyRevenue = Number(revenueMatch[1]);

  if (/\b(disponible|disponibilidad|por las tardes|por las mananas|findes|fines de semana|horas)\b/.test(normalized)) {
    extractedData.contentAvailability = message.trim();
  }

  if (/\b(experiencia|modelo|contenido|creadora|redes|tiktok|instagram)\b/.test(normalized)) {
    extractedData.experienceDescription = message.trim();
  }

  if (/\b(desconfianza|duda|no me fio|raro)\b/.test(normalized)) extractedData.objections = [message.trim()];
  if (/\b(crecer|ganar|mejorar|objetivo|dedicarme)\b/.test(normalized)) extractedData.goals = message.trim();

  if (/\b(ignore|ignora|instrucciones|prompt|sistema|reglas internas)\b/.test(normalized)) {
    internalNotes.push("Possible prompt injection or attempt to reveal internal instructions.");
    return baseOutput("PROMPT_INJECTION", extractedData, 0.9, true, "Intento de obtener instrucciones internas.", internalNotes);
  }

  if (/\b(eres ia|eres una ia|eres un bot|sois ia|hablo con una ia|hablo con un bot)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.88, true, "Pregunta si habla con una IA o bot.", internalNotes);
  }

  const requestedPercentageMatch = normalized.match(/\b(\d{1,3})\s?%/);
  if (requestedPercentageMatch) extractedData.requestedModelPercentage = Number(requestedPercentageMatch[1]);

  if (/\b(porcentaje|comision|cuanto os quedais|reparto|70\/30|salario|sueldo)\b/.test(normalized) || /\b\d{1,3}\s?%/.test(normalized)) {
    const asksForException = /\b(me dais|dame|negociar|negociamos|excepcion|mejorar|bajar|subir|mas para mi)\b/.test(normalized);
    const asksNonStandardNumber = /\b\d{1,3}\s?%/.test(normalized) && !/(70\s?%|30\s?%|70\/30)/.test(normalized);
    const requiresHumanReview = asksForException || asksNonStandardNumber;
    return baseOutput(
      "ASKS_ABOUT_PERCENTAGE",
      extractedData,
      0.86,
      requiresHumanReview,
      requiresHumanReview ? "Pregunta comercial con negociacion, excepcion o porcentaje fuera de politica." : null,
      internalNotes
    );
  }

  if (/\b(contrato|legal|abogado|clausula)\b/.test(normalized)) {
    return baseOutput("ASKS_ABOUT_CONTRACT", extractedData, 0.86, true, "Pregunta contractual o legal.", internalNotes);
  }

  if (/\b(llamada|llamar|telefono|whatsapp)\b/.test(normalized)) {
    return baseOutput(phoneMatch ? "PROVIDES_PHONE" : "REQUESTS_CALL", extractedData, 0.8, false, null, internalNotes);
  }

  if (/\b(aceptada|acepte|acepté|ya os acepte|ya os acepté|solicitud aceptada)\b/.test(normalized)) {
    return baseOutput("ACCEPTS_PROFILE_REQUEST", extractedData, 0.82, false, null, internalNotes);
  }

  if (/\b(no me interesa|paso|no gracias|no quiero)\b/.test(normalized)) return baseOutput("DECLINES", extractedData, 0.82, false, null, internalNotes);

  if (/\b(persona|alex|humano|hablar con alguien)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "La candidata pide hablar con una persona.", internalNotes);
  }

  if (/\b(estafa|enfadada|enfado|me molesta|me suena raro|no me fio)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "Enfado, sospecha o desconfianza.", internalNotes);
  }

  if (extractedData.age) return baseOutput("PROVIDES_AGE", extractedData, 0.78, false, null, internalNotes);
  if (/\b(si|sí|vale|me interesa|info|informacion)\b/.test(normalized)) return baseOutput("CONFIRMS_INTEREST", extractedData, 0.72, false, null, internalNotes);

  return baseOutput(Object.keys(extractedData).length > 0 ? "OTHER" : "UNCLEAR", extractedData, 0.55, false, null, internalNotes);
}

function baseOutput(
  intent: ModelConversationOutput["intent"],
  extractedData: ModelConversationOutput["extractedData"],
  confidence: number,
  requiresHumanReview: boolean,
  humanReviewReason: string | null,
  internalNotes: string[]
): ModelConversationOutput {
  return {
    intent,
    extractedData,
    dataCorrections: [],
    dataContradictions: [],
    confidence,
    commercialQuestionsDetected: intent === "ASKS_ABOUT_PERCENTAGE" ? ["percentage"] : [],
    requestsCall: intent === "REQUESTS_CALL",
    requestsHuman: intent === "REQUESTS_HUMAN",
    isNegotiation: humanReviewReason?.includes("negociacion") ?? false,
    requestedModelPercentage: extractedData.requestedModelPercentage ?? null,
    suggestedStateTransition: null,
    requiresHumanReview,
    humanReviewReason,
    response: "",
    internalNotes,
    provider: "deterministic",
    modelVersion: "deterministic-local-2026-06-08.1",
    promptVersion: "understanding-2026-06-08.1",
    requestedProvider: "DETERMINISTIC",
    actualProvider: "deterministic",
    requestedModel: "deterministic-local-2026-06-08.1",
    actualModel: "deterministic-local-2026-06-08.1",
    usedFallback: false,
    fallbackReason: null,
    durationMs: 0,
    retryCount: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null
  };
}

function mentionsPrivateProfile(normalized: string): boolean {
  return /\b(privada|cuenta privada|perfil privado)\b/.test(normalized);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function titleCase(value: string): string {
  if (!value) return value;
  return value
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
