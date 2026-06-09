import type { ConversationUnderstandingInput, ConversationUnderstandingProvider, ModelConversationOutput } from "./llmProvider";

const phonePattern = /(?:\+34\s?)?(?:6|7|8|9)\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/;
const agePattern = /\b(?:(?:tengo|edad)\s+(\d{1,2})|(\d{1,2})\s*(?:anos|años|aÃ±os|a\b))/i;

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
  if (phoneMatch) {
    extractedData.phone = phoneMatch[0].replace(/[\s.-]/g, "");
  }

  if (/\b(iphone|i phone|ios)\b/.test(normalized)) {
    extractedData.phoneDeviceType = "IPHONE";
    extractedData.hasRequiredIPhone = true;
  }

  if (/\b(android|samsung|xiaomi|huawei|oppo|realme)\b/.test(normalized)) {
    extractedData.phoneDeviceType = "ANDROID";
    extractedData.hasRequiredIPhone = false;
  }

  if (/\b(no tengo iphone|no tengo i phone)\b/.test(normalized)) {
    extractedData.phoneDeviceType = "ANDROID";
    extractedData.hasRequiredIPhone = false;
  }

  if (/\b(comprar[eé]|cambiar[eé]|me comprare|me compraré|me cambio)\b.*\b(iphone|i phone)\b/.test(normalized)) {
    extractedData.phoneDeviceType = "UNKNOWN";
    extractedData.hasRequiredIPhone = null;
    extractedData.objections = [...(extractedData.objections ?? []), "Tiene pensado cambiar a iPhone pronto."];
  }

  const ageMatch = normalized.match(agePattern);
  if (ageMatch) {
    extractedData.age = Number(ageMatch[1] ?? ageMatch[2]);
  }

  if (mentionsPrivateProfile(normalized)) {
    extractedData.profileVisibility = "PRIVATE";
  }

  if (/\b(madrid|barcelona|valencia|sevilla|malaga|málaga|alicante|bilbao|murcia)\b/.test(normalized)) {
    extractedData.city = titleCase(normalized.match(/\b(madrid|barcelona|valencia|sevilla|malaga|málaga|alicante|bilbao|murcia)\b/)?.[0] ?? "");
    extractedData.country = "España";
  }

  if (/\b(onlyfans|of)\b/.test(normalized)) {
    extractedData.hasOnlyFans = true;
  }

  if (/\b(otra agencia|agencia actual|trabajo con agencia|tengo agencia)\b/.test(normalized)) {
    extractedData.worksWithAnotherAgency = true;
  }

  if (/\b(no trabajo con otra agencia|no tengo agencia|sin agencia)\b/.test(normalized)) {
    extractedData.worksWithAnotherAgency = false;
  }

  const revenueMatch = normalized.match(/\b(?:ingreso|ingresos|facturo|gano)\s*(?:unos|sobre)?\s*(\d{3,6})\b/);
  if (revenueMatch) {
    extractedData.currentMonthlyRevenue = Number(revenueMatch[1]);
  }

  if (/\b(disponible|disponibilidad|por las tardes|por las mañanas|findes|fines de semana)\b/.test(normalized)) {
    extractedData.contentAvailability = message.trim();
  }

  if (/\b(experiencia|modelo|contenido|creadora|redes|tiktok|instagram)\b/.test(normalized)) {
    extractedData.experienceDescription = message.trim();
  }

  if (/\b(desconfianza|duda|no me fio|no me fío|raro)\b/.test(normalized)) {
    extractedData.objections = [message.trim()];
  }

  if (/\b(crecer|ganar|mejorar|objetivo|dedicarme)\b/.test(normalized)) {
    extractedData.goals = message.trim();
  }

  if (/\b(ignore|ignora|instrucciones|prompt|sistema|reglas internas)\b/.test(normalized)) {
    internalNotes.push("Possible prompt injection or attempt to reveal internal instructions.");
    return baseOutput("PROMPT_INJECTION", extractedData, 0.9, true, "Intento de obtener instrucciones internas.", internalNotes);
  }

  const requestedPercentageMatch = normalized.match(/\b(\d{1,3})\s?%/);
  if (requestedPercentageMatch) {
    extractedData.requestedModelPercentage = Number(requestedPercentageMatch[1]);
  }

  if (/\b(porcentaje|comision|comisión|cuanto os quedais|cuánto os quedáis|reparto|70\/30|salario|sueldo)\b/.test(normalized) || /\b\d{1,3}\s?%/.test(normalized)) {
    const requiresHumanReview =
      /\b(me dais|dame|negociar|negociamos|quien recibe|quién recibe|quien se queda|quién se queda|70\/30)\b/.test(normalized) || /\b\d{1,3}\s?%/.test(normalized);
    return baseOutput(
      "ASKS_ABOUT_PERCENTAGE",
      extractedData,
      0.86,
      requiresHumanReview,
      requiresHumanReview ? "Pregunta comercial con negociacion, excepcion o reparto no confirmado." : null,
      internalNotes
    );
  }

  if (/\b(contrato|legal|abogado|clausula|cláusula)\b/.test(normalized)) {
    return baseOutput("ASKS_ABOUT_CONTRACT", extractedData, 0.86, true, "Pregunta contractual o legal.", internalNotes);
  }

  if (/\b(llamada|llamar|telefono|teléfono|whatsapp)\b/.test(normalized)) {
    return baseOutput(phoneMatch ? "PROVIDES_PHONE" : "REQUESTS_CALL", extractedData, 0.8, false, null, internalNotes);
  }

  if (/\b(aceptada|acepte|acepté|ya os acept[eé]|solicitud aceptada)\b/.test(normalized)) {
    return baseOutput("ACCEPTS_PROFILE_REQUEST", extractedData, 0.82, false, null, internalNotes);
  }

  if (/\b(no me interesa|paso|no gracias|no quiero)\b/.test(normalized)) {
    return baseOutput("DECLINES", extractedData, 0.82, false, null, internalNotes);
  }

  if (/\b(persona|alex|humano|hablar con alguien)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "La candidata pide hablar con una persona.", internalNotes);
  }

  if (extractedData.age) {
    return baseOutput("PROVIDES_AGE", extractedData, 0.78, false, null, internalNotes);
  }

  if (/\b(si|sí|vale|me interesa|info|informacion|información)\b/.test(normalized)) {
    return baseOutput("CONFIRMS_INTEREST", extractedData, 0.72, false, null, internalNotes);
  }

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
    promptVersion: "understanding-2026-06-08.1"
  };
}

function mentionsPrivateProfile(normalized: string): boolean {
  return /\b(privada|cuenta privada|perfil privado)\b/.test(normalized);
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFC");
}

function titleCase(value: string): string {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
