import type { ConversationUnderstandingInput, ConversationUnderstandingProvider, ModelConversationOutput } from "./llmProvider";
import { deviceEligibilityForDescription, deviceModelForDescription, deviceTypeForDescription } from "./policyRules";

const phonePatterns: readonly RegExp[] = [
  // Argentina: prefijo +54 (con o sin "+"), "9" de movil opcional y 10 digitos (codigo de area + numero) con espacios/guiones.
  /(?<!\d)\+?54[\s.-]?(?:9[\s.-]?)?(?:\d{2}[\s.-]?\d{4}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/,
  // Colombia: prefijo +57 (con o sin "+") y movil de 10 digitos que empieza por 3.
  /(?<!\d)\+?57[\s.-]?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/,
  // España: prefijo +34 opcional y 9 digitos que empiezan por 6/7/8/9, con CUALQUIER agrupacion de
  // separadores (3-3-3 "612 345 678", 2-2-2-2 "612 34 56 78" o sin espacios "612345678").
  /(?<!\d)(?:\+34[\s.-]?)?[6789](?:[\s.-]?\d){8}(?!\d)/,
  // LATAM local sin prefijo de pais: 10 digitos agrupados, p. ej. "11 2345 6789" (AR) o "3001234567" (CO).
  /(?<!\d)(?:\d{2}[\s.-]?\d{4}[\s.-]?\d{4}|\d{3}[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/
];
// (?!\d) evita leer "tengo 1500000 seguidores" como edad 15 (invariante 2: una edad fantasma cierra adultas).
// El lookahead de sustantivos contables impide leer "tengo 2 cuentas" como edad 2: "tengo N" solo
// es edad si N no va seguido de un contable ("cuentas", "seguidores", "hijos"...). "N años" se sigue
// resolviendo por la segunda rama.
// Incluye cantidades/periodos ("14 mil seguidores", "15 dias libres", "3 meses"): sin esto, una
// adulta que presume de seguidores ("no tengo 14 mil seguidores") se leia como edad 14 -> CLOSED.
const ageCountNounLookahead =
  "(?!\\s+(?:cuentas?|seguidor[ae]s?|hij[oa]s?|perr[oa]s?|gat[oa]s?|fotos?|videos?|mil(?:es)?|dias?|semanas?|meses|horas?|minutos?|a\\b))";
// La segunda rama solo acepta "anos"/"años" explicito: "a" suelta es la preposicion castellana ("de 9
// a 14", "tengo 25 a alguien"), no la abreviatura de "años", y leerla como edad cerraba a adultas como
// menores (de "hablamos de 9 a 14" salia age=9 -> CLOSED). El lookahead de la rama 1 sigue cubriendo "a".
const agePattern = new RegExp(
  `\\b(?:(?:tengo|edad)\\s+(\\d{1,2})(?!\\d)${ageCountNounLookahead}|(\\d{1,2})\\s*(?:anos|años|anitos|añitos))`,
  "i"
);
// Version global del mismo patron para recorrer TODAS las coincidencias (matchAll) y elegir la
// primera que no sea una duracion ("llevo 5 años, tengo 25" -> 25, no 5).
const agePatternGlobal = new RegExp(agePattern.source, "gi");

// Declaracion de minoria de edad. Invariante 2 (INNEGOCIABLE): una menor SIEMPRE se cierra y NUNCA
// se confirma como adulta. Se detecta ANTES del agePattern para que "no tengo 18" no se lea como
// "tengo 18" (edad 18 -> adulta confirmada, el peor fallo posible hallado en la auditoria del 14-jun).
// Opera sobre el texto ya normalizado (sin acentos): "años"->"anos", "añitos"->"anitos".
const wordAgesUnder18: Readonly<Record<string, number>> = {
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17
};

function declaredMinorAge(normalized: string): number | null {
  // Minoria explicita sin cifra: "soy menor", "menor de edad", "no soy mayor de edad".
  if (
    /\b(?:soy|aun soy|todavia soy)\s+menor\b/.test(normalized) ||
    /\bmenor de edad\b/.test(normalized) ||
    /\bno soy mayor de edad\b/.test(normalized)
  ) {
    return 17;
  }
  // "(aun|todavia) no tengo N" / "no tengo N (todavia|aun)" con N<=18 -> casi N, es menor (~N-1).
  // Se excluyen contables/dinero para no leer "no tengo 200 euros" como edad.
  const notYet = normalized.match(
    /\bno tengo\s+(\d{1,2})\b(?!\s*(?:cuentas?|seguidor[ae]s?|hij[oa]s?|perr[oa]s?|gat[oa]s?|fotos?|videos?|euros?|dolares?|mil(?:es)?|dias?|semanas?|meses|horas?|minutos?))/
  );
  if (notYet) {
    const declared = Number(notYet[1]);
    if (declared <= 18) return Math.max(1, declared - 1);
  }
  // Numeros en letra menores de 18 en contexto de edad ("tengo dieciseis", "quince anos"), evitando
  // "hace quince anos" (un periodo de tiempo, no la edad).
  for (const [word, value] of Object.entries(wordAgesUnder18)) {
    if (new RegExp(`\\btengo\\s+${word}\\b`).test(normalized)) return value;
    if (new RegExp(`(?<!hace\\s)\\b${word}\\s+(?:anos|años|anitos|añitos)\\b`).test(normalized)) return value;
  }
  return null;
}

// Demanda de dinero garantizado: cifra + moneda + periodicidad ("500 dolares por semana"),
// cifra + "garantizados", o verbo de exigencia + cifra + periodicidad. NO matchea declaraciones
// de facturacion propia ("facturo 1200 al mes"). Compartido con el planner (escalada comercial).
export const guaranteedMoneyDemandPattern =
  /\b\d{2,6}\s?(?:dolares|euros|usd|eur|\$|€)\s*(?:por semana|a la semana|semanal(?:es)?|al mes|por mes|mensual(?:es)?|garantizad[oa]s?|fijos?)\b|\b\d{2,6}\s?garantizad[oa]s?\b|\b(?:quiero|pido|necesito|exijo)\s+(?:un minimo de\s+)?\d{2,6}\b[^.!?]{0,25}\b(?:por semana|a la semana|al mes|por mes|por adelantado)\b/;

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

// "soy laura" captura nombre; "soy de madrid" / "soy argentina" / "soy modelo" no.
const explicitNamePattern = /\b(?:me llamo|mi nombre es)\s+([a-zñ]{2,})/;
const casualNamePattern = /\bsoy\s+([a-zñ]{3,})\b/;
const nameStopwords = new Set([
  "del",
  "los",
  "las",
  "una",
  "muy",
  "mas",
  "menor",
  "mayor",
  "modelo",
  "creadora",
  "chica",
  "nueva",
  "mama",
  "madre",
  "argentina",
  "colombiana",
  "espanola",
  "mexicana",
  "venezolana",
  "uruguaya",
  "chilena",
  "peruana",
  "ecuatoriana",
  "interesada",
  "seria",
  "timida"
]);

function extractFirstName(normalized: string): string | undefined {
  const explicitMatch = normalized.match(explicitNamePattern);
  const candidateName = explicitMatch?.[1] ?? normalized.match(casualNamePattern)?.[1];
  if (!candidateName) return undefined;
  if (!explicitMatch) {
    if (nameStopwords.has(candidateName)) return undefined;
    if (locationKeywords.some((entry) => entry.keyword === candidateName)) return undefined;
  }
  return candidateName.charAt(0).toUpperCase() + candidateName.slice(1);
}

export interface DeterministicExtractionContext {
  /** Ultimo mensaje del agente: si pidio el telefono, un numero pelado ("5550147") ES el telefono. */
  lastAgentMessage?: string | null;
}

export class DeterministicUnderstandingProvider implements ConversationUnderstandingProvider {
  async understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput> {
    return extractDeterministicUnderstanding(input.inboundMessage, {
      lastAgentMessage: lastAgentLineFromRecentMessages(input.recentMessages)
    });
  }
}

function lastAgentLineFromRecentMessages(recentMessages: readonly string[]): string | null {
  for (let index = recentMessages.length - 1; index >= 0; index -= 1) {
    const line = recentMessages[index];
    if (line?.startsWith("agent: ")) return line.slice("agent: ".length);
  }
  return null;
}

const agentAskedPhonePattern = /\b(numero|telefono|whatsapp|wassap|wasap)\b/;
// Mensaje compuesto solo por digitos y separadores: la respuesta tipica a "pasame tu numero".
const bareNumberMessagePattern = /^[\s\d+().-]{6,24}$/;

// Patrones del ULTIMO mensaje del agente que abren un slot concreto: una respuesta pelada de la
// candidata (nombre suelto, numero suelto, si/no) consume ese slot. Sin este contexto, una palabra
// suelta no es un nombre ni un si/no es un dato (regresion answer-slot blindness, iteracion 3).
const agentAskedNamePattern = /\b(como te llamas|cual es tu nombre|tu nombre|te llamas)\b/;
const agentAskedAgePattern = /\b(que edad tienes|cuantos anos|tu edad)\b/;
const agentAskedOnlyFansPattern = /\b(tienes of|has tenido of|tienes onlyfans|has tenido onlyfans|of activo)\b/;
const agentAskedAgenciesPattern = /\botras? agencias?\b/;

// Una edad pelada es uno o dos digitos como respuesta a "que edad tienes?", admitiendo el prefijo
// "edad:" y ruido final de puntuacion/emoji ("17!", "17 :)", "edad: 17"). No matchea numeros con un
// contable detras ("17 cuentas"): eso evita edades fantasma (invariante 2). Solo se usa si el agente
// acaba de preguntar la edad, asi que el ruido final es seguro.
const bareAgeMessagePattern = /^\s*(?:edad\s*:?\s*)?(\d{1,2})\s*(?:anos|años|anitos|añitos)?\s*[\p{P}\p{S}\s]*$/u;

// Respuestas afirmativas/negativas peladas a una pregunta cerrada del agente. El "si" se admite
// doblado o alargado ("sisi", "si si", "siii") sin confundir "siempre"/"siento" (que NO son un si):
// si+(?:\s*si+)* solo casa repeticiones de "si", y \b corta antes de otras letras.
const bareYesPattern = /^\s*(si+(?:\s*si+)*|sip|claro|por supuesto|asi es|correcto|afirmativo|exacto|obvio|obviamente)\b/;
// El "no" se admite doblado/alargado ("nono", "no no", "noo") igual que el "si" afirmativo.
const bareNoPattern = /^\s*(no+(?:\s*no+)*|nop|nunca|jamas|negativo|para nada|que va)\b/;

// Fillers, saludos y dias de la semana que NUNCA son un nombre aunque el agente lo pida.
const nameRejectWords = new Set([
  "vale",
  "hola",
  "holaa",
  "buenas",
  "jaja",
  "jajaja",
  "jeje",
  "claro",
  "gracias",
  "bueno",
  "ok",
  "okey",
  "okay",
  "si",
  "sii",
  "no",
  "nop",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
  "manana",
  "hoy",
  "ahora",
  "perfecto",
  "genial"
]);

/**
 * Lee un nombre pelado ("Noelia", "gisell torres") cuando el agente acaba de pedir el nombre.
 * Toma solo la primera palabra, rechaza fillers/saludos/dias y exige caracteres alfabeticos.
 */
function bareNameFromReply(normalized: string): string | undefined {
  const trimmed = normalized.trim();
  // Solo letras y espacios, una o dos palabras: una respuesta pelada de nombre, no una frase.
  if (!/^[a-zñ]{2,}(?:\s+[a-zñ]{2,})?$/.test(trimmed)) return undefined;
  const firstWord = trimmed.split(/\s+/)[0];
  if (nameRejectWords.has(firstWord)) return undefined;
  if (nameStopwords.has(firstWord)) return undefined;
  if (locationKeywords.some((entry) => entry.keyword === firstWord)) return undefined;
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

export function extractDeterministicUnderstanding(
  message: string,
  context: DeterministicExtractionContext = {}
): ModelConversationOutput {
  const normalized = normalize(message);
  const extractedData: ModelConversationOutput["extractedData"] = {};
  const internalNotes: string[] = [];

  // El agente acaba de pedir el numero y la candidata responde solo con digitos: es el telefono
  // (fallo real de iteracion 1: numeros locales cortos tipo "5550147" se ignoraban y el bot
  // volvia a pedir el numero recien recibido).
  const agentAskedPhone =
    typeof context.lastAgentMessage === "string" && agentAskedPhonePattern.test(normalize(context.lastAgentMessage));
  const inboundIsBareNumber = bareNumberMessagePattern.test(normalized.trim());
  const mentionsPhoneContext =
    /\b(numero|telefono|whatsapp|wassap|wasap|movil|celular|cel)\b/.test(normalized) || (agentAskedPhone && inboundIsBareNumber);
  const phone = extractPhone(normalized, mentionsPhoneContext);
  if (phone) extractedData.phone = phone;

  // Contexto del ultimo mensaje del agente: una respuesta pelada consume el slot que el agente
  // acaba de abrir (nombre, edad, OF, agencias). Determinista al 100%, jamas controla el flujo.
  const lastAgent = typeof context.lastAgentMessage === "string" ? normalize(context.lastAgentMessage) : "";
  const agentAskedName = agentAskedNamePattern.test(lastAgent);
  const agentAskedAge = agentAskedAgePattern.test(lastAgent);
  const agentAskedOnlyFans = agentAskedOnlyFansPattern.test(lastAgent);
  const agentAskedAgencies = agentAskedAgenciesPattern.test(lastAgent);

  const firstName = extractFirstName(normalized) ?? (agentAskedName ? bareNameFromReply(normalized) : undefined);
  if (firstName) extractedData.firstName = firstName;

  // Numero pelado de una o dos cifras como respuesta a "que edad tienes?": esa SI es la edad.
  // Un numero embebido en una frase ("tengo 2 cuentas") nunca se lee como edad (invariante 2).
  const bareAgeMatch = agentAskedAge ? bareAgeMessagePattern.exec(normalized) : null;
  if (bareAgeMatch) extractedData.age = Number(bareAgeMatch[1]);

  // Si/no pelado a la pregunta de OF o de agencias: consume ese slot concreto.
  if (extractedData.hasOnlyFans === undefined && agentAskedOnlyFans) {
    if (bareYesPattern.test(normalized)) extractedData.hasOnlyFans = true;
    else if (bareNoPattern.test(normalized)) extractedData.hasOnlyFans = false;
    // "Tengo dos", "tengo una cuenta activa", "ya tengo" como respuesta a "¿tienes OF?" = SI lo tiene,
    // aunque no diga la palabra "of" (replay 15-jun: se repreguntaba OF en bucle). Excluye "tengo que".
    else if (/\b(?:ya\s+)?tengo\b/.test(normalized) && !/\bno tengo\b/.test(normalized) && !/\btengo que\b/.test(normalized))
      extractedData.hasOnlyFans = true;
  }
  if (extractedData.worksWithAnotherAgency === undefined && agentAskedAgencies) {
    if (bareYesPattern.test(normalized)) extractedData.worksWithAnotherAgency = true;
    else if (bareNoPattern.test(normalized)) extractedData.worksWithAnotherAgency = false;
  }

  const deviceType = deviceTypeForDescription(normalized);
  if (deviceType !== "UNKNOWN") extractedData.deviceType = deviceType;
  const deviceModel = deviceModelForDescription(normalized);
  if (deviceModel) extractedData.deviceModel = deviceModel;
  // La elegibilidad solo se clasifica si el mensaje menciona un movil de verdad (marca/tipo/modelo):
  // 'malo'/'viejo'/'roto' en un contexto NO-movil (sobre la persona, "estoy malo y viejo") no debe
  // disparar NOT_ELIGIBLE. Los moviles malos reales SIEMPRE nombran el dispositivo (samsung viejo,
  // redmi antiguo, movil roto), asi que mentionsDevice los cubre.
  const mentionsDevice = deviceType !== "UNKNOWN" || Boolean(deviceModel);
  const deviceEligibility = mentionsDevice ? deviceEligibilityForDescription(normalized) : "UNKNOWN";
  if (deviceEligibility !== "UNKNOWN") extractedData.deviceEligibility = deviceEligibility;

  if (/\b(iphone|i phone|ios)\b/.test(normalized)) {
    extractedData.deviceType = "IPHONE";
  }

  if (/\b(android|samsung|xiaomi|huawei|oppo|realme|pixel|galaxy|motorola|moto)\b/.test(normalized)) {
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
  // La declaracion de minoria tiene prioridad sobre el agePattern: "no tengo 18" es menor, no "18".
  const minorAge = declaredMinorAge(normalized);
  if (minorAge !== null) {
    extractedData.age = minorAge;
  } else {
    // Se recorren TODAS las coincidencias y se toma la primera que NO sea una DURACION: asi "llevo 5
    // años, tengo 25" coge 25 y no 5. Una "N años" es DURACION (no edad) si su misma clausula lleva un
    // marcador temporal (hace/llevo/desde/durante/van) o va seguida de "de experiencia/trabajando/...".
    // "N años de edad" SI es edad. Sin suelo numerico: "12 años" cierra como menor (invariante 2).
    const stripped = stripPhoneSpans(normalized);
    for (const m of stripped.matchAll(agePatternGlobal)) {
      const value = Number(m[1] ?? m[2]);
      const idx = m.index ?? 0;
      const clausePrefix = (
        stripped
          .slice(0, idx)
          .split(/[,.;!?]/)
          .pop() ?? ""
      ).trim();
      const after = stripped.slice(idx, idx + (m[0]?.length ?? 0) + 22);
      const durationBefore = /\b(hace|llevo|desde|durante|van|llevaba|llevamos)\b/.test(clausePrefix);
      // Marcadores FUERTES de duracion (hace/llevo/de experiencia/trabajando): siempre duracion. "de
      // edad" NUNCA es duracion (es edad). Marcadores DEBILES ("en esto/en el sector") solo son
      // duracion si el valor es <13; en rango de menor (13-17) se trata como EDAD y cierra (invariante 2).
      const strongDurationAfter =
        /anos?\s+(?:de\s+(?:experiencia|trabajo|profesion|carrera|antiguedad)|trabajand|haciend|dedicad|metid|currand)/.test(
          after
        );
      const weakDurationAfter = /anos?\s+en\s+(?:esto|el sector|el mundillo|el rubro|of|onlyfans|la plataforma)/.test(after);
      if (durationBefore || strongDurationAfter || (weakDurationAfter && value < 13)) continue;
      extractedData.age = value;
      break;
    }
  }

  if (mentionsPrivateProfile(normalized)) extractedData.profileVisibility = "PRIVATE";

  const locationMatch = normalized.match(locationPattern);
  if (locationMatch) {
    const location = locationKeywords.find((entry) => entry.keyword === locationMatch[0]);
    if (location) {
      extractedData.country = location.country;
      if (location.city) extractedData.city = location.city;
    }
  }

  // "only"/"of" son la abreviatura coloquial real de OnlyFans, PERO sin contexto cazaban ingles
  // ("the best of me" -> hasOnlyFans=true, falso). Se exige "onlyfans" literal o que "only"/"of" vaya
  // pegado a un verbo/posesivo castellano de OF ("tengo of", "uso only", "mi of", "of activo").
  if (
    /\bonlyfans\b/.test(normalized) ||
    /\b(?:tengo|tienes|tuve|tenia|mi|tu|el|un|uso|usaba|abri|cree|hago|hice|en|de|con)\s+(?:only|of)\b/.test(normalized) ||
    /\b(?:only|of)\s+(?:activ|abiert|cuenta|propi)/.test(normalized)
  )
    extractedData.hasOnlyFans = true;
  // Negacion antes de la mencion ("no tengo of", "nunca tuve onlyfans", "no, jamas use only").
  if (/\b(no tengo onlyfans|sin onlyfans|no tengo of)\b/.test(normalized)) extractedData.hasOnlyFans = false;
  if (/\b(?:no|nunca|jamas)\b[^.!?]{0,30}\b(?:onlyfans|only|of)\b/.test(normalized)) extractedData.hasOnlyFans = false;

  if (/\b(otra agencia|agencia actual|trabajo con agencia|tengo agencia)\b/.test(normalized))
    extractedData.worksWithAnotherAgency = true;
  // Negacion en cualquier formulacion ("no he trabajado con agencias", "nunca trabaje con agencias",
  // "no trabajo con ninguna agencia"): una negacion a <=30 chars de "agencia(s)" es un NO. Va despues
  // del positivo para corregir "no trabajo con otra agencia" (que el positivo marcaria true).
  if (/\b(?:no|nunca|jamas|ninguna)\b[^.!?]{0,30}\bagencias?\b/.test(normalized)) extractedData.worksWithAnotherAgency = false;

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

  // Demanda de dinero garantizado ("500 dolares por semana", "quiero 800 garantizados al mes"):
  // negociacion salarial real que debe escalar a revision humana, nunca acabar en un "Okeyy".
  const demandsGuaranteedMoney = guaranteedMoneyDemandPattern.test(normalized);

  if (
    /\b(porcentaje|comision|cuanto os quedais|reparto|70\/30|salario|sueldo|cuanto pagan|cuanto pagais|cuanto me pagan|me pagan|nos pagan|cuando pagan|cuando cobro|como son los pagos|me pagarian|cuanto se gana|cuanto ganaria|cuanto cobraria|cuanto cobrar[ie]a|cuanto me llevo|cuanto me llevaria|cuanto me queda|cuanto me quedaria|cuanto me toca|cuanto saco|cuanto sacaria|que me llevo|mi parte)\b/.test(
      normalized
    ) ||
    /\b\d{1,3}\s?%/.test(normalized) ||
    demandsGuaranteedMoney
  ) {
    const asksForException = /\b(me dais|dame|negociar|negociamos|excepcion|mejorar|bajar|subir|mas para mi)\b/.test(normalized);
    const asksNonStandardNumber = /\b\d{1,3}\s?%/.test(normalized) && !/(70\s?%|30\s?%|70\/30)/.test(normalized);
    const requiresHumanReview = asksForException || asksNonStandardNumber || demandsGuaranteedMoney;
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

  if (/\b(llamada|llamar|llamame|telefono|whatsapp|numero|celular)\b/.test(normalized) || (phone !== null && agentAskedPhone)) {
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

function extractPhone(normalized: string, allowShortLocalNumbers = false): string | null {
  for (const pattern of phonePatterns) {
    const match = normalized.match(pattern);
    if (match) return match[0].replace(/\D/g, "");
  }

  // Numeros locales cortos (7-8 digitos) solo si el mensaje habla explicitamente de telefono
  // o responde a la peticion del agente: sin ese contexto serian falsos positivos (precios,
  // seguidores, fechas...).
  if (allowShortLocalNumbers) {
    const shortMatch = normalized.match(/(?<!\d)\d{7,8}(?!\d)/) ?? normalized.match(/(?<!\d)\d{3,4}[\s.-]\d{4}(?!\d)/);
    if (shortMatch) return shortMatch[0].replace(/\D/g, "");
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
