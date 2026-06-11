import type { ConversationUnderstandingInput, ConversationUnderstandingProvider, ModelConversationOutput } from "./llmProvider";
import { deviceEligibilityForDescription, deviceModelForDescription, deviceTypeForDescription } from "./policyRules";

const phonePatterns: readonly RegExp[] = [
  // Argentina: prefijo +54 (con o sin "+"), "9" de movil opcional y 10 digitos (codigo de area + numero) con espacios/guiones.
  /(?<!\d)\+?54[\s.-]?(?:9[\s.-]?)?(?:\d{2}[\s.-]?\d{4}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/,
  // Colombia: prefijo +57 (con o sin "+") y movil de 10 digitos que empieza por 3.
  /(?<!\d)\+?57[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  // España: prefijo +34 opcional y 9 digitos que empiezan por 6/7/8/9.
  /(?<!\d)(?:\+34[\s.-]?)?[6789]\d{2}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/,
  // LATAM local sin prefijo de pais: 10 digitos agrupados, p. ej. "11 2345 6789" (AR) o "3001234567" (CO).
  /(?<!\d)(?:\d{2}[\s.-]?\d{4}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/
];
const agePattern = /\b(?:(?:tengo|edad)\s+(\d{1,2})|(\d{1,2})\s*(?:anos|años|a\b))/i;

function stripPhoneSpans(text: string): string {
  let result = text;
  for (const pattern of phonePatterns) {
    result = result.replace(new RegExp(pattern.source, "g"), " ");
  }
  return result;
}

interface LocationKeyword {
  readonly keyword: string;
  readonly country: string;
  readonly city: string | null;
}

const locationKeywords: readonly LocationKeyword[] = [
  { keyword: "mar del plata", country: "Argentina", city: "Mar del Plata" },
  { keyword: "buenos aires", country: "Argentina", city: "Buenos Aires" },
  { keyword: "la plata", country: "Argentina", city: "La Plata" },
  { keyword: "argentina", country: "Argentina", city: null },
  { keyword: "cordoba", country: "Argentina", city: "Cordoba" },
  { keyword: "rosario", country: "Argentina", city: "Rosario" },
  { keyword: "mendoza", country: "Argentina", city: "Mendoza" },
  { keyword: "colombia", country: "Colombia", city: null },
  { keyword: "medellin", country: "Colombia", city: "Medellín" },
  { keyword: "bogota", country: "Colombia", city: "Bogotá" },
  { keyword: "cali", country: "Colombia", city: "Cali" },
  { keyword: "barranquilla", country: "Colombia", city: "Barranquilla" },
  { keyword: "bucaramanga", country: "Colombia", city: "Bucaramanga" },
  { keyword: "pereira", country: "Colombia", city: "Pereira" },
  { keyword: "uruguay", country: "Uruguay", city: null },
  { keyword: "montevideo", country: "Uruguay", city: "Montevideo" },
  { keyword: "espana", country: "España", city: null },
  { keyword: "madrid", country: "España", city: "Madrid" },
  { keyword: "barcelona", country: "España", city: "Barcelona" },
  { keyword: "valencia", country: "España", city: "Valencia" },
  { keyword: "sevilla", country: "España", city: "Sevilla" },
  { keyword: "malaga", country: "España", city: "Malaga" },
  { keyword: "alicante", country: "España", city: "Alicante" },
  { keyword: "bilbao", country: "España", city: "Bilbao" },
  { keyword: "murcia", country: "España", city: "Murcia" }
];

const locationPattern = new RegExp(`\\b(?:${locationKeywords.map((entry) => entry.keyword).join("|")})\\b`);

export class DeterministicUnderstandingProvider implements ConversationUnderstandingProvider {
  async understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput> {
    return extractDeterministicUnderstanding(input.inboundMessage);
  }
}

export function extractDeterministicUnderstanding(message: string): ModelConversationOutput {
  const normalized = normalize(message);
  const extractedData: ModelConversationOutput["extractedData"] = {};
  const internalNotes: string[] = [];

  const phone = extractPhone(normalized);
  if (phone) extractedData.phone = phone;

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

  if (
    /\b(comprare|compraré|cambiare|cambiaré|me comprare|me compraré|me cambio)\b.*\b(iphone|i phone|galaxy|s23|s24|s25)\b/.test(
      normalized
    )
  ) {
    extractedData.deviceType = "UNKNOWN";
    extractedData.deviceEligibility = "PENDING_UPGRADE";
    extractedData.objections = [...(extractedData.objections ?? []), "Tiene pensado comprar un dispositivo valido pronto."];
  }

  // Los numeros argentinos locales empiezan por "11"/"15": si la candidata escribe
  // "tengo 11 2345 6789" no podemos leer edad 11 y cerrarla como menor (invariante 2).
  const ageMatch = stripPhoneSpans(normalized).match(agePattern);
  if (ageMatch) extractedData.age = Number(ageMatch[1] ?? ageMatch[2]);

  if (mentionsPrivateProfile(normalized)) extractedData.profileVisibility = "PRIVATE";

  const locationMatch = normalized.match(locationPattern);
  if (locationMatch) {
    const location = locationKeywords.find((entry) => entry.keyword === locationMatch[0]);
    if (location) {
      extractedData.country = location.country;
      if (location.city) extractedData.city = location.city;
    }
  }

  if (/\b(onlyfans|of)\b/.test(normalized)) extractedData.hasOnlyFans = true;
  if (/\b(no tengo onlyfans|sin onlyfans|no tengo of)\b/.test(normalized)) extractedData.hasOnlyFans = false;

  if (/\b(otra agencia|agencia actual|trabajo con agencia|tengo agencia)\b/.test(normalized))
    extractedData.worksWithAnotherAgency = true;
  if (/\b(no trabajo con otra agencia|no tengo agencia|sin agencia)\b/.test(normalized))
    extractedData.worksWithAnotherAgency = false;

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

  if (
    /\b(porcentaje|comision|cuanto os quedais|reparto|70\/30|salario|sueldo)\b/.test(normalized) ||
    /\b\d{1,3}\s?%/.test(normalized)
  ) {
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
    return baseOutput(phone ? "PROVIDES_PHONE" : "REQUESTS_CALL", extractedData, 0.8, false, null, internalNotes);
  }

  if (/\b(aceptada|acepte|acepté|ya os acepte|ya os acepté|solicitud aceptada)\b/.test(normalized)) {
    return baseOutput("ACCEPTS_PROFILE_REQUEST", extractedData, 0.82, false, null, internalNotes);
  }

  if (/\b(no me interesa|paso|no gracias|no quiero)\b/.test(normalized))
    return baseOutput("DECLINES", extractedData, 0.82, false, null, internalNotes);

  if (/\b(persona|alex|humano|hablar con alguien)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "La candidata pide hablar con una persona.", internalNotes);
  }

  if (/\b(estafa|enfadada|enfado|me molesta|me suena raro|no me fio)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "Enfado, sospecha o desconfianza.", internalNotes);
  }

  if (extractedData.age) return baseOutput("PROVIDES_AGE", extractedData, 0.78, false, null, internalNotes);
  if (/\b(si|sí|vale|me interesa|info|informacion)\b/.test(normalized))
    return baseOutput("CONFIRMS_INTEREST", extractedData, 0.72, false, null, internalNotes);

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

function extractPhone(normalized: string): string | null {
  for (const pattern of phonePatterns) {
    const match = normalized.match(pattern);
    if (match) return match[0].replace(/\D/g, "");
  }
  return null;
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
