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
  "(?!\\s+(?:cuentas?|seguidor[ae]s?|hij[oa]s?|perr[oa]s?|gat[oa]s?|fotos?|videos?|reels?|tatuajes?|publicacion(?:es)?|pedidos?|kilos?|pesos?|euros?|dolares?|mil(?:es)?|dias?|semanas?|meses|horas?|minutos?|a\\b))";
// "tengo 15 plus iphone" / "tengo 13 pro" etc.: el numero es parte del MODELO de movil, NO la edad. Sin esto,
// "tengo 15 plus iphone" leia edad 15 y CERRABA a una adulta como menor (trampa real del QA 26-jun, mensaje
// literal de una candidata). Solo excluye "tengo/edad N" cuando va seguido de una palabra de movil; "tengo 15",
// "tengo 15 anos" o "tengo 16" (edades reales de menor) NO se ven afectados -> la deteccion de menores intacta.
const phoneModelLookahead =
  "(?!\\s+(?:plus|pro|max|ultra|mini|iphone|i\\s?phone|samsung|galaxy|xiaomi|redmi|pixel|moto|motorola|huawei|oppo|realme|honor|poco))";
// La segunda rama solo acepta "anos"/"años" explicito: "a" suelta es la preposicion castellana ("de 9
// a 14", "tengo 25 a alguien"), no la abreviatura de "años", y leerla como edad cerraba a adultas como
// menores (de "hablamos de 9 a 14" salia age=9 -> CLOSED). El lookahead de la rama 1 sigue cubriendo "a".
// Tercera rama "cumplir N": SOLO cumpleanos PASADO/completado ("acabo de cumplir 18", "recien cumpli
// 19", "ya cumpli 21", "he cumplido 19"). Antes, sin la palabra "años" la candidata se quedaba sin edad
// y el bot re-preguntaba en bucle. CRITICO (invariante 2): se exige forma pasada (cumpli/cumplio/cumplido
// o "acabo de cumplir"); el INFINITIVO/FUTURO ("voy a cumplir 18", "cumplire 18", "pronto cumplo 18")
// NO casa aqui -> declaredMinorAge lo trata como la menor que aun es (ver notYetTurnsAge). Restringida a
// 13-99 para que "cumpli los 10 reels" no se lea como edad 10.
const agePattern = new RegExp(
  `\\b(?:(?:tengo|edad)\\s+(\\d{1,2})(?!\\d)${ageCountNounLookahead}${phoneModelLookahead}|(\\d{1,2})\\s*(?:anos|años|anitos|añitos)|(?:acab\\w+\\s+de\\s+cumplir|cumpli|cumplio|cumplido)\\s+(?:los\\s+)?(1[3-9]|[2-9]\\d)(?!\\d)${ageCountNounLookahead})`,
  "i"
);
// Version global del mismo patron para recorrer TODAS las coincidencias (matchAll) y elegir la
// primera que no sea una duracion ("llevo 5 años, tengo 25" -> 25, no 5).
const agePatternGlobal = new RegExp(agePattern.source, "gi");

// Detecta "aun NO los tiene": un cumpleanos NEGADO ("no he cumplido 18") o en FUTURO/INTENCION ("voy a
// cumplir 18", "pronto cumplo 18", "cuando cumpla 18", "el viernes cumplo 18", "cumplire 18"). Devuelve
// la edad N que TODAVIA no cumple, o null. El llamador (declaredMinorAge) la trata como menor (~N-1)
// cuando N<=18. Defensa en profundidad del invariante 2: la rama positiva "cumplir N" del agePattern solo
// casa PASADO, asi que un futuro no capturado aqui se queda sin edad (re-pregunta segura), nunca adulta.
// El lookahead de contables evita leer "voy a cumplir 18 mil seguidores" como edad.
// Excluye contables ("18 mil seguidores") y, sobre todo, ANIVERSARIOS/DURACION ("10 anos como modelo",
// "5 anos en la empresa", "8 anos de novia/casada/juntos") para que "pronto cumplo 10 anos como modelo"
// NO se lea como edad 10 y cierre a una adulta. Un "cumplir N anos" SIN ese contexto ("voy a cumplir 18
// anos") SI es edad y se trata como menor que aun no los tiene. Reusa el criterio de duracion del loop.
const notAgeCountLookahead =
  "(?!\\s*(?:mil(?:es)?|seguidor[ae]s?|cuentas?|euros?|dolares?|pesos?|fotos?|videos?|reels?|tatuajes?|publicacion(?:es)?|pedidos?|kilos?))(?!\\s*anos?\\s+(?:como|de|en|trabajand|haciend|dedicad|currand|junt|casad|sali|novi|relacion|pareja))";
const futureTimeMarker =
  "voy a|vas a|va a|vamos a|van a|cuando|pronto|manana|proxim\\w+|a punto de|en\\s+(?:\\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|pocos?|unos?|unas?)\\s+(?:dias?|semanas?|meses?)|(?:la semana|el mes|el ano|el dia) que viene|este (?:finde|mes|lunes|martes|miercoles|jueves|viernes|sabado|domingo)|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)";
function notYetTurnsAge(normalized: string): number | null {
  const num = `(\\d{1,2})\\b${notAgeCountLookahead}`;
  const negated = normalized.match(
    new RegExp(`\\bno\\s+(?:aun\\s+|todavia\\s+)?(?:los\\s+)?(?:he\\s+)?cumpl\\w*\\s+(?:los\\s+)?${num}`)
  );
  if (negated) return Number(negated[1]);
  const futureConj = normalized.match(new RegExp(`\\bcumplir[ae]\\s+(?:los\\s+)?${num}`));
  if (futureConj) return Number(futureConj[1]);
  const futureBefore = normalized.match(
    new RegExp(`\\b(?:${futureTimeMarker})\\b[^.!?]{0,25}?\\bcumpl\\w*\\s+(?:los\\s+)?${num}`)
  );
  if (futureBefore) return Number(futureBefore[1]);
  const futureAfter = normalized.match(new RegExp(`\\bcumpl\\w*\\s+(?:los\\s+)?${num}[^.!?]{0,25}?\\b(?:${futureTimeMarker})`));
  if (futureAfter) return Number(futureAfter[1]);
  return null;
}

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
  // "casi (tengo) N", "tengo casi N", "casi 18": AUN no tiene N -> con N<=18 es la menor que todavia es
  // (~N-1). CRITICO invariante 2: sin esto "casi tengo 18" leia "tengo 18" como ADULTA (peor fallo, QA
  // 21-jun) y "tengo casi 18" se quedaba sin edad (limbo). Las tres formas EXCLUYEN contables y duraciones
  // ("casi 18 mil seguidores", "tengo casi 10 anos en esto", "tengo casi 18 euros", "casi 3 hijos") para no
  // cerrar a una ADULTA por error (invariante 2 en sentido inverso). La forma suelta "casi N" ademas se
  // restringe a 15-18 (es donde esta el riesgo de menor) para no tragarse cualquier cifra suelta.
  const almostExcl =
    "(?!\\s+(?:cuentas?|seguidor[ae]s?|hij[oa]s?|perr[oa]s?|gat[oa]s?|fotos?|videos?|reels?|tatuajes?|publicacion(?:es)?|pedidos?|kilos?|pesos?|euros?|dolares?|mil(?:es)?|dias?|semanas?|meses|horas?|minutos?))" +
    "(?!\\s*anos?\\s+(?:como|de|en|trabajand|haciend|dedicad|currand|junt|casad|sali|novi|relacion|pareja))";
  const almostAge =
    normalized.match(new RegExp(`\\bcasi\\s+tengo\\s+(\\d{1,2})\\b${almostExcl}`)) ??
    normalized.match(new RegExp(`\\btengo\\s+casi\\s+(\\d{1,2})\\b${almostExcl}`)) ??
    normalized.match(new RegExp(`\\bcasi\\s+(1[5-8])\\b${almostExcl}`));
  if (almostAge) {
    const declaredAlmost = Number(almostAge[1]);
    if (declaredAlmost <= 18) return Math.max(1, declaredAlmost - 1);
  }
  // "(aun|todavia) no tengo N" / "no tengo N (todavia|aun)" con N<=18 -> casi N, es menor (~N-1).
  // Se excluyen contables/dinero para no leer "no tengo 200 euros" como edad.
  const notYet = normalized.match(
    /\bno tengo\s+(\d{1,2})\b(?!\s*(?:cuentas?|seguidor[ae]s?|hij[oa]s?|perr[oa]s?|gat[oa]s?|fotos?|videos?|reels?|tatuajes?|publicacion(?:es)?|pedidos?|kilos?|euros?|dolares?|pesos?|mil(?:es)?|dias?|semanas?|meses|horas?|minutos?))/
  );
  if (notYet) {
    const declared = Number(notYet[1]);
    if (declared <= 18) return Math.max(1, declared - 1);
  }
  // "Aun NO los tiene": cumpleanos NEGADO ("no he cumplido 18") o FUTURO/INTENCION ("voy a cumplir 18",
  // "pronto cumplo 18", "cuando cumpla 18", "el viernes cumplo 18", "cumplire 18"). En todos la candidata
  // todavia no tiene N anos -> con N<=18 es menor (~N-1) y se cierra. CRITICO (invariante 2): sin esto la
  // rama positiva "cumplir N" leeria "voy a cumplir 18" como adulta de 18 cuando todavia tiene 17.
  const notYetCumplirAge = notYetTurnsAge(normalized);
  if (notYetCumplirAge !== null && notYetCumplirAge <= 18) {
    return Math.max(1, notYetCumplirAge - 1);
  }
  // Misma negacion pero con la edad en LETRA: "(aun|todavia) no tengo dieciocho" es MENOR, igual que
  // "no tengo 18". Sin esto, spelledAdultAge leia "tengo dieciocho" dentro de "no tengo dieciocho" como
  // adulta de 18 (regresion del invariante 2 detectada el 16-jun).
  // Admite un adverbio entre medias ("no tengo aun dieciocho") y hereda la exclusion de contables/dinero
  // de la rama de digitos, para no cerrar por error "no tengo dieciocho mil seguidores".
  const notYetWord = normalized.match(
    /\bno tengo\s+(?:aun\s+|todavia\s+)?([a-zñ]+)\b(?!\s+(?:mil(?:es)?|seguidor[ae]s?|cuentas?|euros?|dolares?|fotos?|videos?|hij[oa]s?|perr[oa]s?|gat[oa]s?|dias?|semanas?|meses|horas?|minutos?))/
  );
  if (notYetWord) {
    const declaredWord = ({ ...wordAgesUnder18, dieciocho: 18 } as Record<string, number>)[notYetWord[1]];
    if (declaredWord !== undefined && declaredWord <= 18) return Math.max(1, declaredWord - 1);
  }
  // Numeros en letra menores de 18 en contexto de edad ("tengo dieciseis", "quince anos"), evitando
  // "hace quince anos" (un periodo de tiempo, no la edad).
  for (const [word, value] of Object.entries(wordAgesUnder18)) {
    if (new RegExp(`\\btengo\\s+${word}\\b`).test(normalized)) return value;
    if (new RegExp(`(?<!hace\\s)\\b${word}\\s+(?:anos|años|anitos|añitos)\\b`).test(normalized)) return value;
  }
  return null;
}

// Duda de edad por APARIENCIA (invariante 2, defensa en profundidad): la candidata afirma una edad pero
// el texto sugiere que aparenta/es menor de 18 ("parezco de 15", "aparento menor de edad", "cara de
// nina"). No afirma ser menor (eso lo cierra declaredMinorAge), pero introduce duda razonable. Patrones
// conservadores para no escalar a cualquier adulta: exige una cifra <18 tras parecer/aparentar, o una
// palabra explicita de minoria/infancia. "parezco mayor / de 20 / de mi edad" NUNCA dispara.
function looksUnderageDoubt(normalized: string): boolean {
  // Palabra explicita de aparentar minoria/infancia: "parezco/aparento menor (de edad)", "cara de nina".
  if (
    /\b(?:parezco|aparento|dicen que (?:parezco|aparento)|me dicen que (?:parezco|aparento)|tengo cara de|cara de)\b[^.!?]{0,20}\b(?:menor(?:\s+de\s+edad)?|nin[ao]|cria|adolescente|quinceaner[ao])\b/.test(
      normalized
    )
  ) {
    return true;
  }
  // "parezco/aparento ... de/como/unos N" con N en 1-17 (cifra concreta de menor). El conector de edad
  // (de/como/unos) evita falsos positivos con digitos sueltos ("parezco la 1 de la noche"). \b evita
  // casar "18"/"20"/"25".
  if (/\b(?:parezco|aparento)\b[^.!?]{0,8}?\b(?:de|como|unos?)\s+(1[0-7]|[1-9])\b/.test(normalized)) {
    return true;
  }
  return false;
}

// Edades en LETRA de ADULTA (>=18): "tengo veintidos", "treinta y cinco" suelto. Los <18 en letra los
// cubre declaredMinorAge ANTES (invariante 2). Solo se acepta con "tengo X" o como respuesta suelta exacta
// (no "<palabra> años" libre) para no leer una DURACION ("llevo veinte años en esto") como edad. Sin esto,
// "tengo veintidos" dejaba la edad sin parsear y el bot re-preguntaba en bucle (hallazgo jueces 16-jun).
const wordAgesAdult: Readonly<Record<string, number>> = {
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40
};
const adultUnitWords: Readonly<Record<string, number>> = {
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9
};

function spelledAdultAge(normalized: string): number | null {
  const trimmed = normalized.trim();
  // Una edad NEGADA ("no tengo dieciocho") nunca confirma adulta (invariante 2; la maneja declaredMinorAge).
  const negated = /\bno tengo\b/.test(trimmed);
  const compound = trimmed.match(/\b(treinta|cuarenta)\s+y\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)\b/);
  if (compound && !negated && (/\btengo\b/.test(trimmed) || trimmed === compound[0])) {
    return (compound[1] === "treinta" ? 30 : 40) + adultUnitWords[compound[2]];
  }
  for (const [word, value] of Object.entries(wordAgesAdult)) {
    if (!negated && new RegExp(`\\btengo\\s+${word}\\b`).test(trimmed)) return value;
    if (trimmed === word) return value;
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

// "soy laura" captura nombre; "soy de madrid" / "soy argentina" / "soy modelo" no. Tambien el orden
// invertido "Yesica es mi nombre" (caso real 5-jul: el fallback lo perdia y repreguntaba en bucle).
const explicitNamePattern = /\b(?:me llamo|mi nombre es)\s+([a-zñ]{2,})|\b([a-zñ]{2,})\s+es mi nombre\b/;
// [\s,] tras "soy" para captar la coma tras el saludo ("buenas tardes soy, Vanesa" — caso real 5-jul:
// la coma rompia el match y el bot repreguntaba el nombre en bucle en el fallback determinista).
const casualNamePattern = /\bsoy[\s,]+([a-zñ]{3,})\b/;
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
  // Grupo 1: "me llamo X / mi nombre es X"; grupo 2: "X es mi nombre" (orden invertido, caso Yesica).
  const candidateName = explicitMatch?.[1] ?? explicitMatch?.[2] ?? normalized.match(casualNamePattern)?.[1];
  if (!candidateName) return undefined;
  if (!explicitMatch) {
    if (nameStopwords.has(candidateName)) return undefined;
    if (locationKeywords.some((entry) => entry.keyword === candidateName)) return undefined;
  }
  // Ni el nombre del BOT ni acuses se aceptan jamas como nombre de ella (caso real Melisa 5-jul:
  // "Hola Alex" la bautizo "Alex" en el fallback — Alex es quien escribe, no ella).
  if (nameRejectWords.has(candidateName)) return undefined;
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
const agentAskedDevicePattern =
  /\b(que movil tienes|que movil|con que movil|que telefono|que dispositivo|movil tienes|grabas con|con que grabas|tienes (?:un |buen )?(?:iphone|movil))\b/;
// El agente pidio el MODELO EXACTO (aclaracion del slot de movil tras una respuesta vaga). Si la candidata
// AUN no nombra el aparato, no se repite mas: se marca PENDING (Alex valora). Decision de Alex 23-jun.
const agentAskedDeviceModelPattern = /\b(marca y (?:el )?modelo|modelo de movil tienes exactamente|modelo exacto)\b/;
// Descriptor de mala calidad del movil (para resolver el dead-end cuando NO se nombra el aparato).
const deviceQualityReplyPattern =
  /\b(viej[oa]|mal[oa]|malisim[oa]|mala calidad|roto|rota|gama baja|antigu[oa]|cascad[oa]|destrozad[oa]|fatal|para el arrastre|hecho polvo|una caca|de mierda|cutre|lent[oa]|no sirve|no graba bien)\b/;

// Una edad pelada es uno o dos digitos como respuesta a "que edad tienes?", admitiendo el prefijo
// "edad:" y ruido final de puntuacion/emoji ("17!", "17 :)", "edad: 17"). No matchea numeros con un
// contable detras ("17 cuentas"): eso evita edades fantasma (invariante 2). Solo se usa si el agente
// acaba de preguntar la edad, asi que el ruido final es seguro.
const bareAgeMessagePattern = /^\s*(?:edad\s*:?\s*)?(\d{1,2})\s*(?:anos|años|anitos|añitos)?\s*[\p{P}\p{S}\s]*$/u;
// Edad de CABECERA: el mensaje EMPIEZA por un numero de edad (1-2 cifras) aunque DESPUES siga texto, que es
// lo que pasa cuando la candidata manda la edad y una coletilla en burbujas distintas ("48\nes suficiente?")
// o juntas ("48 es suficiente?"). Solo se usa como BACKSTOP (cuando el agente acaba de preguntar la edad y
// NADA mas la extrajo), por eso es seguro leer la cabecera. Reusa el lookahead de contables (invariante 2:
// "48 cuentas"/"2 fotos" NO es edad), (?!\d) impide leer "4800" como 48 y (?![.,]\d) excluye decimales
// ("1.80 metros" no es edad 1). Una cifra <18 se lee LITERAL y decideNextState cierra (invariante 2 intacto).
// (?!\s+\d) y (?!\s*[\/-]\s*\d) impiden leer la 1a cifra de DOS grupos numericos como edad: telefono con
// espacios ("11 2345 6789"), cifras de reparto ("70 30"), disponibilidad ("18 30 horas"), rangos ("48 50").
const leadingAgeMessagePattern = new RegExp(
  `^\\s*(?:edad\\s*:?\\s*)?(\\d{1,2})(?!\\d)(?![.,]\\d)(?!\\s+\\d)(?!\\s*[\\/-]\\s*\\d)${ageCountNounLookahead}`,
  "iu"
);
// DURACION en cabecera ("8 anios trabajando", "25 anos de experiencia", typo "anios" incluido): no es edad,
// la cabecera se descarta (el agePattern principal ya lo trata como duracion cuando lleva tilde; esto cubre
// el caso que llega aqui sin extraer). El caso "aun no los cumple" NO se enumera aqui (lista negra que
// siempre tiene fugas): se cubre con la regla de FRONTERA del 18 en el backstop (ver abajo).
const headerAgeIsDuration = /^\s*\d{1,2}\s+(?:anios|anos|años)\s+(?:de\b|como\b|en\b|trabajand|haciend|dedicad|currand|metid)/;
// REGLA DE FRONTERA del 18 (invariante 2): el 18 es el UNICO valor donde menor/adulta se decide por la
// coletilla que sigue al numero (un 19+ no se vuelve menor por nada; un 13-17 cierra igual). El 18 solo se
// lee como adulta si tras el numero NO hay NADA que pueda significar "aun no los cumplo": ni una LETRA (Unicode
// \p{L}, no solo a-z: cubre arabe/griego/cirilico) ni un SIMBOLO/emoji (\p{S}: 🎂/⏳/🥳 de "pronto los cumplo").
// Solo se admite puntuacion/espacios trivial ("18", "18!", "18 :)"). Asi no hay lista negra que enumerar.
function ageHeaderTrustworthy(value: number, tail: string): boolean {
  if (value !== 18) return true;
  return !/[\p{L}\p{S}]/u.test(tail);
}

// Respuestas afirmativas/negativas peladas a una pregunta cerrada del agente. El "si" se admite
// doblado o alargado ("sisi", "si si", "siii") sin confundir "siempre"/"siento" (que NO son un si):
// si+(?:\s*si+)* solo casa repeticiones de "si", y \b corta antes de otras letras.
const bareYesPattern = /^\s*(si+(?:\s*si+)*|sip|claro|por supuesto|asi es|correcto|afirmativo|exacto|obvio|obviamente)\b/;
// El "no" se admite doblado/alargado ("nono", "no no", "noo") igual que el "si" afirmativo.
const bareNoPattern = /^\s*(no+(?:\s*no+)*|nop|nunca|jamas|negativo|para nada|que va)\b/;
// Negacion CLARA dentro de la frase: "claro que no", "pues no", "no nunca", "que va". bareYesPattern casa
// "claro"/"obvio" al inicio, asi que "claro que no, nunca tuve" se leia como SI: esta negacion tiene
// prioridad sobre el si pelado para no invertir la respuesta (fallo real de la revision 19-jun).
const clearNegationPattern = /\bque no\b|\bpues no\b|\bclaro que no\b|\bnunca\b|\bjamas\b|\bpara nada\b|\bque va\b|^\s*no\b/;

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
  // El nombre del PROPIO BOT jamas es el de ella ("Hola Alex" bautizaba a Melisa como "Alex", 5-jul).
  "alex",
  "ok",
  "okey",
  "okay",
  "dale",
  "listo",
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
  "genial",
  // Interjecciones/muletillas de chat: nunca son un nombre, aunque el opener acabe de pedir el nombre.
  "mmm",
  "mm",
  "mmmm",
  "hmm",
  "aja",
  "ajam",
  "ajaja",
  "aham",
  "eh",
  "em",
  "este",
  "pues",
  "nose",
  "ya",
  "uy",
  "oki",
  "oka",
  "okeyy",
  "okeey"
]);

/**
 * Lee un nombre pelado ("Noelia", "gisell torres") cuando el agente acaba de pedir el nombre.
 * Toma solo la primera palabra, rechaza fillers/saludos/dias y exige caracteres alfabeticos.
 */
// Saludos de apertura (solo estos) que pueden preceder al nombre: "hola silvana", "buenas ana". NO
// incluye acuses ("vale", "dale") a proposito: "vale dale" / "dale contame" NO llevan nombre.
const leadingGreetingPattern = /^(?:h?ola+|holaa*|holis+|wenas+|buen[ao]s+|hey+|hello+|hi+)$/;

function bareNameFromReply(normalized: string): string | undefined {
  const trimmed = normalized.trim();
  // Solo letras y espacios, una o dos palabras: una respuesta pelada de nombre, no una frase. (Sin coma a
  // proposito: "Vale, dale" / "Dale, contame" son acuses, no nombres; la coma los deja fuera.)
  if (!/^[a-zñ]{2,}(?:\s+[a-zñ]{2,})?$/.test(trimmed)) return undefined;
  const words = trimmed.split(/\s+/);
  // SALTA un SALUDO inicial (solo saludo, no cualquier filler): "hola silvana" / "buenas ana" -> el nombre
  // es la 2a palabra (bug real 5-jul: "Hola silvana" se descartaba entero y el bot repreguntaba en bucle).
  const idx = words.length > 1 && leadingGreetingPattern.test(words[0]) ? 1 : 0;
  const firstWord = words[idx];
  // isImplausibleFirstName rechaza saludos/lugares/stopwords/ruido, asi que "buenas tardes" -> undefined.
  if (isImplausibleFirstName(firstWord)) return undefined;
  return firstWord.charAt(0).toUpperCase() + firstWord.slice(1);
}

/**
 * ¿El "nombre" extraido es en realidad un filler/saludo/lugar o ruido ("claro", "vale", "madrid",
 * "mmm")? Se aplica a CUALQUIER nombre, venga del extractor determinista o del LLM (en modo OpenAI el
 * nombre que adivina el modelo se colaba sin estos guardas). Solo mira la primera palabra normalizada.
 */
export function isImplausibleFirstName(name: string): boolean {
  const firstWord = normalize(name).trim().split(/\s+/)[0] ?? "";
  if (firstWord.length < 2) return true;
  // Un nombre solo lleva letras (3-jul: '/xf' pasó como nombre y se imprimió 'Perfecto /xf' a una
  // candidata real). Guiones/apóstrofes permitidos; los acentos ya se normalizaron.
  if (/[^a-zñ'-]/.test(firstWord)) return true;
  if (/^(.)\1+$/.test(firstWord)) return true; // "mmm", "aaa"
  // Familia de saludos CON typos/letras repetidas ("Buenoss diass", "holaaa", "wenas"): jamás son un
  // nombre (re-sonda 4-jul: Ana contestó "Buenoss diass" a la pregunta del nombre y la ficha quedó
  // bautizada "Buenoss"; el "mi nombre es ana" posterior ya no corregía). "Diana"/"Sol" no matchean.
  if (/^(?:h?ola+|holis+|wenas+|buen[ao]s*|dia+s*|tarde+s*|noche+s*|saludos+|hey+|hello+)$/.test(firstWord)) return true;
  if (nameRejectWords.has(firstWord)) return true;
  if (nameStopwords.has(firstWord)) return true;
  if (locationKeywords.some((entry) => entry.keyword === firstWord)) return true;
  return false;
}

/**
 * ¿El mensaje aporta un nombre de forma legitima? True si la candidata lo dice explicitamente
 * ("me llamo X", "soy X") o si el agente acababa de preguntarlo. Replica las condiciones del extractor
 * determinista, asi que NO rechaza ningun nombre que aquel ya capturaria; sirve para que el LLM no fije
 * un nombre a partir de un "sii claro ya esta" donde no se ha dado ningun nombre.
 */
export function hasNameGivingContext(inboundMessage: string, lastAgentMessage: string | null): boolean {
  const normalized = normalize(inboundMessage);
  if (explicitNamePattern.test(normalized) || casualNamePattern.test(normalized)) return true;
  const agent = lastAgentMessage ? normalize(lastAgentMessage) : "";
  return agentAskedNamePattern.test(agent);
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
  const agentAskedDevice = agentAskedDevicePattern.test(lastAgent);
  const agentAskedDeviceModel = agentAskedDeviceModelPattern.test(lastAgent);

  const firstName = extractFirstName(normalized) ?? (agentAskedName ? bareNameFromReply(normalized) : undefined);
  if (firstName) extractedData.firstName = firstName;

  // Numero pelado de una o dos cifras como respuesta a "que edad tienes?": esa SI es la edad.
  // Un numero embebido en una frase ("tengo 2 cuentas") nunca se lee como edad (invariante 2).
  const bareAgeMatch = agentAskedAge ? bareAgeMessagePattern.exec(normalized) : null;
  if (bareAgeMatch) {
    const value = Number(bareAgeMatch[1]);
    // Frontera del 18 tambien aqui: "18 🎂"/"18 ⏳" (pronto los cumplo) no es adulta confirmada (invariante 2).
    const tail = normalized.replace(/^\s*(?:edad\s*:?\s*)?\d{1,2}\s*(?:anos|años|anitos|añitos)?/, "");
    if (ageHeaderTrustworthy(value, tail)) extractedData.age = value;
  }

  // Si/no pelado a la pregunta de OF o de agencias: consume ese slot concreto.
  if (extractedData.hasOnlyFans === undefined && agentAskedOnlyFans) {
    // La negacion (pelada o clara "claro que no") se evalua ANTES que el si pelado para no invertir.
    if (bareNoPattern.test(normalized) || clearNegationPattern.test(normalized)) extractedData.hasOnlyFans = false;
    else if (bareYesPattern.test(normalized)) extractedData.hasOnlyFans = true;
    // "Tengo dos", "tengo una cuenta activa", "ya tengo" como respuesta a "¿tienes OF?" = SI lo tiene,
    // aunque no diga la palabra "of" (replay 15-jun: se repreguntaba OF en bucle). Excluye "tengo que".
    else if (/\b(?:ya\s+)?tengo\b/.test(normalized) && !/\bno tengo\b/.test(normalized) && !/\btengo que\b/.test(normalized))
      extractedData.hasOnlyFans = true;
  }
  if (extractedData.worksWithAnotherAgency === undefined && agentAskedAgencies) {
    if (bareNoPattern.test(normalized) || clearNegationPattern.test(normalized)) extractedData.worksWithAnotherAgency = false;
    else if (bareYesPattern.test(normalized)) extractedData.worksWithAnotherAgency = true;
  }

  // Menciones NEGADAS de marca ("No es ni iphone ni samsung", "no tengo iphone") se QUITAN antes de
  // extraer: no son su movil. Caso real Marianel 6-jul: su "No es ni iphone / Ni samsung" (aclarando que
  // su Nubia no era ninguna de las dos) se extraia como deviceModel "iphone ni samsung" y PISABA la Nubia
  // real de la ficha. Solo se limpia la frase negada; una afirmacion en el mismo mensaje sobrevive
  // ("no tengo iphone, tengo un samsung s23" sigue extrayendo el s23).
  const deviceScrubbed = normalized.replace(
    /\b(?:no\s+(?:es|tengo|uso)|tampoco(?:\s+es)?|ni)\s+(?:un\s+|una\s+|el\s+|la\s+)?(?:iphone|i\s?phone|ipone|iphon|samsung|sansung|galaxy|galaxi|xiaomi|redmi|motorola|moto|huawei|pixel|oppo|realme)\b/g,
    " "
  );
  const deviceType = deviceTypeForDescription(deviceScrubbed);
  if (deviceType !== "UNKNOWN") extractedData.deviceType = deviceType;
  const deviceModel = deviceModelForDescription(deviceScrubbed);
  if (deviceModel) extractedData.deviceModel = deviceModel;
  // La elegibilidad solo se clasifica si el mensaje menciona un movil de verdad (marca/tipo/modelo):
  // 'malo'/'viejo'/'roto' en un contexto NO-movil (sobre la persona, "estoy malo y viejo") no debe
  // disparar NOT_ELIGIBLE. Los moviles malos reales SIEMPRE nombran el dispositivo (samsung viejo,
  // redmi antiguo, movil roto), asi que mentionsDevice los cubre.
  const mentionsDevice = deviceType !== "UNKNOWN" || Boolean(deviceModel);
  let deviceEligibility = mentionsDevice ? deviceEligibilityForDescription(deviceScrubbed) : "UNKNOWN";
  // P1-8 (QA 21-jun): respuesta de mala calidad a la pregunta del movil SIN nombrar el aparato ("uno
  // viejo", "malisimo", "esta roto") -> NO dejarla en UNKNOWN (dead-end/bucle de "Okeyy"). Se clasifica
  // con el texto (viejo/malo/roto -> NOT_ELIGIBLE); si aun asi no se reconoce, PENDING_QUALITY_TEST para
  // pedir el modelo exacto. Gateado por agentAskedDevice para no leer "estoy mala y vieja" (sobre ella).
  if (!mentionsDevice && agentAskedDevice && deviceQualityReplyPattern.test(normalized)) {
    const fromText = deviceEligibilityForDescription(normalized);
    deviceEligibility = fromText !== "UNKNOWN" ? fromText : "PENDING_QUALITY_TEST";
  }
  // Tras pedir el MODELO EXACTO (aclaracion del slot de movil) la candidata SIGUE sin nombrar el aparato
  // (un positivo vago: "esta bien", "hago buenas fotos"): no se repite mas -> PENDING_QUALITY_TEST (movil
  // "conocido": sigue cualificando y Alex lo valora con su socio). Cierra el bucle del positivo vago (Alex 23-jun).
  // SOLO si sigue UNKNOWN: si el bloque P1-8 ya lo clasifico como NOT_ELIGIBLE ("es viejo", "esta roto"), NO
  // se suaviza a PENDING — un movil declarado malo sigue siendo NO apto (no pisar el gate de hardware).
  if (!mentionsDevice && agentAskedDeviceModel && deviceEligibility === "UNKNOWN") {
    deviceEligibility = "PENDING_QUALITY_TEST";
  }
  if (deviceEligibility !== "UNKNOWN") extractedData.deviceEligibility = deviceEligibility;

  if (/\b(iphone|i phone|ios)\b/.test(deviceScrubbed)) {
    extractedData.deviceType = "IPHONE";
  }

  if (/\b(android|samsung|xiaomi|huawei|oppo|realme|pixel|galaxy|motorola|moto)\b/.test(deviceScrubbed)) {
    extractedData.deviceType = /\b(samsung|galaxy)\b/.test(deviceScrubbed) ? "SAMSUNG" : "OTHER";
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
      const value = Number(m[1] ?? m[2] ?? m[3]);
      const idx = m.index ?? 0;
      const clausePrefix = (
        stripped
          .slice(0, idx)
          .split(/[,.;!?]/)
          .pop() ?? ""
      ).trim();
      const after = stripped.slice(idx, idx + (m[0]?.length ?? 0) + 22);
      const durationBefore = /\b(hace|llevo|desde|durante|van|llevaba|llevamos)\b/.test(clausePrefix);
      // SAFETY-FIRST (invariante 2): una cifra en rango de menor (13-17) se trata como edad y cierra,
      // aunque vaya con contexto de duracion despues ("tengo 16 años trabajando", "13 años de
      // experiencia": podria ser una menor). EXCEPCION: un verbo de duracion claro DELANTE (llevo/hace/
      // desde) la hace inequivocamente experiencia de adulta ("llevo 15 años"), no edad.
      if (value >= 13 && value <= 17 && !durationBefore) {
        extractedData.age = value;
        break;
      }
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
    // Edad en LETRA de adulta si no se detecto nada con digitos ("tengo veintidos" -> 22). Va dentro del
    // else (la minoria en letra ya la resolvio declaredMinorAge), asi nunca pisa el cierre de menores.
    if (extractedData.age === undefined) {
      const spelled = spelledAdultAge(normalized);
      if (spelled !== null) extractedData.age = spelled;
    }
    // BACKSTOP de edad (Alex 25-jun): el agente acaba de preguntar la edad y NADA anterior la extrajo
    // (ni declaredMinorAge, ni "tengo N"/"N años", ni en letra), pero el mensaje EMPIEZA por un numero de
    // edad aunque venga pegado a una coletilla ("48\nes suficiente?"). Esa cabecera ES la edad. Determinista
    // y gateado por agentAskedAge: solo se aplica respondiendo a la pregunta de edad.
    //
    // INVARIANTE 2 (regla de FRONTERA, no lista negra): el 18 es el UNICO valor donde menor/adulta se decide
    // por la coletilla ("18 en julio"/"18 me faltan dias" = aun 17). Por eso el 18 SOLO se lee como adulta si
    // NO hay coletilla con texto (bare "18", "18!", "18 :)"); cualquier letra detras -> limbo seguro (re-
    // pregunta), nunca adulta borde. Asi no hay que enumerar cada forma de "aun no los cumplo" (lista negra
    // que el revisor demostro que siempre tiene fugas). 13-17 se leen SIEMPRE (cierran, invariante 2 correcto)
    // y 19+ se leen SIEMPRE (ninguna coletilla los vuelve menores). La duracion en cabecera se descarta aparte.
    if (extractedData.age === undefined && agentAskedAge && !headerAgeIsDuration.test(normalized)) {
      const leadingAge = leadingAgeMessagePattern.exec(normalized);
      if (leadingAge) {
        const value = Number(leadingAge[1]);
        if (ageHeaderTrustworthy(value, normalized.slice(leadingAge[0].length))) extractedData.age = value;
      }
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
  // La ventana NO cruza burbujas (3-jul, Romy: el 'NUNCA' de la burbuja de AGENCIAS alcanzo el 'only'
  // de la burbuja siguiente y piso el true correcto de 'tuve only'): corta en salto de linea.
  if (/\b(?:no|nunca|jamas)\b[^.!?\n]{0,30}\b(?:onlyfans|only|of)\b/.test(normalized)) extractedData.hasOnlyFans = false;

  // Positivo: ademas de "otra agencia/tengo agencia", el pasado/plural real ("trabaje con 4 agencias", "siempre
  // trabaje con agencias", "he trabajado con agencias") -> el slot ya estaba respondido y NO debe re-preguntarse.
  if (
    /\b(otra agencia|agencia actual|trabajo con agencia|tengo agencia)\b/.test(normalized) ||
    // Incluye el GERUNDIO ("trabajando con una agencia" = hecho presente): sin el "ando", "Tengo un perfil
    // trabajando con una agencia" no rellenaba el slot y el bot RE-PREGUNTABA la agencia (caso real Janna
    // 5-jul). NO se incluye el infinitivo "trabajar" A PROPOSITO: es futuro/hipotetico/pregunta ("me gustaria
    // trabajar con una agencia", "quiero trabajar con una agencia como la vuestra") y marcaria como que YA
    // trabaja con otra a un lead que justo quiere unirse (regresion cazada por el revisor 5-jul). La negacion
    // de abajo sigue ganando ("no trabajo con agencias").
    /\b(?:he\s+)?trabaj(?:e|o|ando|ado|aba|amos)\b[^.!?]{0,20}\bagencias?\b/.test(normalized)
  )
    extractedData.worksWithAnotherAgency = true;
  // Negacion en cualquier formulacion ("no he trabajado con agencias", "nunca trabaje con agencias",
  // "no trabajo con ninguna agencia"): una negacion a <=30 chars de "agencia(s)" es un NO. Va despues
  // del positivo para corregir "no trabajo con otra agencia" (que el positivo marcaria true).
  if (/\b(?:no|nunca|jamas|ninguna)\b[^.!?\n]{0,30}\bagencias?\b/.test(normalized)) extractedData.worksWithAnotherAgency = false;
  // Trabajo SOLA / sin agencia: tambien es respuesta al slot ("trabaje sola", "sin agencia", "por mi cuenta").
  // Los terminos genericos (sola/independiente/freelance) solo cuentan si el agente PREGUNTO por agencias, para
  // no marcar false por "soy autonoma"/"trabajo sola" dichos en otro contexto. Va al final para ganar al positivo.
  if (
    /\bsin (?:ninguna )?agencias?\b/.test(normalized) ||
    (agentAskedAgencies &&
      /\b(sola|por mi cuenta|por mi propia cuenta|de forma independiente|independiente|freelance|autonoma)\b/.test(normalized))
  )
    extractedData.worksWithAnotherAgency = false;

  // Facturacion (revisor 4-jul: el respaldo determinista era estrecho y el descarte anti-cruces tiraba
  // cifras legitimas del LLM). Tres formas: verbo de ganar + cifra ("gano 800", "saco unos 900€", "hago
  // 600 al mes") con lookahead que excluye unidades no-dinero ("hago 600 fotos" NO es facturacion);
  // cifra pegada a "al mes" ("600 al mes"); o cifra sola/con moneda cuando el AGENTE acaba de preguntar
  // la facturacion. Nada de esto toca edades: "tengo 46" no lleva verbo de ganar, ni "al mes", ni ancla.
  const agentAskedRevenue =
    /\b(facturando|facturas|facturacion|cuanto (estas )?(ganando|generando|sacando)|cuanto ganas|ingresos)\b/.test(lastAgent);
  const revenueMatch =
    normalized.match(
      /\b(?:ingreso|ingresos|facturo|facturaba|gano|ganaba|saco|sacaba|genero|generaba|hago|hacia)\s*(?:unos|sobre|casi|como)?\s*(\d{3,6})\s*(?:€|euros?|eur|dolares|usd)?\b(?!\s*(?:fotos?|videos?|posts?|seguidores|likes|horas?|minutos?))/
    ) ??
    normalized.match(/\b(\d{3,6})\s*(?:€|euros?|eur|dolares|usd)?\s*al mes\b/) ??
    (agentAskedRevenue ? normalized.match(/\b(\d{3,6})\s*(?:€|euros?|eur|dolares|usd)?\b/) : null);
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

  // ¿Habla con una IA/bot? Cubre tuteo ("eres"), voseo LATAM ("sos") y formas con "esto es / o un bot"
  // ("sos una persona real o un bot?"). Dispara la respuesta de transparencia (reason con "ia"/"bot").
  if (
    /\b(?:eres|sos|sois|esto es|es esto|sera esto|hablo con|estoy hablando con|estoy con)\b[^.!?]{0,15}?\b(?:una?\s+)?(?:ia|bot|maquina|robot|contestador|grabacion|inteligencia artificial)\b|\bo (?:un|una)\s+(?:bot|ia|maquina|robot)\b/.test(
      normalized
    )
  ) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.88, true, "Pregunta si habla con una IA o bot.", internalNotes);
  }

  // SAFETY-FIRST (invariante 2): edad adulta-limite (18-22) declarada PERO con duda de aparentar menor.
  // Va antes que las ramas comerciales: la seguridad manda sobre cualquier pregunta de pago/contrato.
  // Solo MARCA revision humana (no cierra ni decide flujo): Alex verifica. Modo determinista, sin OpenAI.
  if (extractedData.age !== undefined && extractedData.age >= 18 && extractedData.age <= 22 && looksUnderageDoubt(normalized)) {
    internalNotes.push("Edad dudosa: declara mayor de edad pero el texto sugiere aparentar ser menor de 18.");
    return baseOutput(
      "PROVIDES_AGE",
      extractedData,
      0.8,
      true,
      "Edad dudosa: declara mayor de edad pero menciona aparentar ser menor.",
      internalNotes
    );
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
    const asksForException = /\b(me dais|dame|negociar|negociamos|excepcion|mejora\w*|baj[ae]\w*|sub[ei]\w*|mas para mi)\b/.test(
      normalized
    );
    const asksNonStandardNumber =
      (/\b\d{1,3}\s?%/.test(normalized) || /\b\d{1,2}\/\d{1,2}\b/.test(normalized)) && !/(70\s?%|30\s?%|70\/30)/.test(normalized);
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

  // OJO: "alex" NO va aqui. El bot SE PRESENTA como Alex ("soy Alex de Rose Models"), asi que una
  // candidata simpatica que dice "Hola Alex", "Gracias Alex" o "Un gusto Alex!" (en Argentina, casi
  // todas) NO pide un humano: el bot ya es Alex. Antes "alex" a secas escalaba a HIR y el bot enmudecia,
  // matando el saludo calido (caso real Vanesa 5-jul, en el fallback determinista). Pedir un humano de
  // verdad se capta por "persona/humano/hablar con alguien" y por la desconfianza/agresion de abajo.
  if (/\b(persona|humano|hablar con alguien)\b/.test(normalized)) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "La candidata pide hablar con una persona.", internalNotes);
  }

  // Desconfianza (incluida la leve: "como se que es real?", "mala espina", "sois de fiar?") y AGRESION
  // (insultos): decision de Alex (16-jun) -> escalan a el (HUMAN_INTERVENTION_REQUIRED) y le llega aviso.
  if (
    /\b(estaf\w*|tim[oa]\w*|timador\w*|enfadada|enfadado|enfado|me molesta|me suena raro|no me fio|mala espina|como se que (?:es real|es verdad|sois reales|no es estafa)|sois de fiar|me puedo fiar|sois fiables|no sera (?:una )?estafa|sera (?:una )?estafa|fraude|que asco|sois una basura|panda de|os (?:voy a )?denunci\w*|os denuncio|ladron\w*|ladrones|sinverguenza\w*|mierda)\b/.test(
      normalized
    )
  ) {
    return baseOutput("REQUESTS_HUMAN", extractedData, 0.82, true, "Enfado, sospecha, desconfianza o agresion.", internalNotes);
  }

  // ULTIMO PASO antes del fall-through y DESPUES de todas las ramas de seguridad/negocio (inyeccion, IA/bot,
  // edad dudosa, %/negociacion, contrato, llamada, DECLINES, persona, desconfianza): si la candidata hizo una
  // pregunta PERSONAL/SOCIAL dirigida al bot ("y tu?", "quien eres?", "como estas?"), se marca como senal
  // ortogonal para que el planner la responda PRIMERO y luego reconduzca. No cambia el intent ni el flujo
  // (invariante 1) y nunca pisa la seguridad (esas ramas ya retornaron arriba). Bug "Ana / Y tu?" (Alex 22-jun).
  const personalQuestion = detectPersonalQuestion(normalized);

  if (extractedData.age) return baseOutput("PROVIDES_AGE", extractedData, 0.78, false, null, internalNotes, personalQuestion);
  // 'estoy interesada' es frase LITERAL del lanzamiento (3-jul, Ana) que caía en UNCLEAR.
  if (/\b(si|sí|vale|me interesa|estoy interesad[ao]|interesad[ao]|info|informacion)\b/.test(normalized))
    return baseOutput("CONFIRMS_INTEREST", extractedData, 0.72, false, null, internalNotes, personalQuestion);

  return baseOutput(
    Object.keys(extractedData).length > 0 ? "OTHER" : "UNCLEAR",
    extractedData,
    0.55,
    false,
    null,
    internalNotes,
    personalQuestion
  );
}

// Detecta una pregunta PERSONAL/SOCIAL dirigida al bot. Solo se usa en el fall-through (cuando ningun patron
// de negocio ni de seguridad consumio el turno), asi que nunca roba esos casos. Tres categorias:
//  - IDENTITY: quien es / como se llama / de donde es el bot ("y tu?", "quien eres?", "de donde sos?").
//  - RECIPROCAL_PERSONAL: le devuelve un dato personal intimo al bot (edad, estado civil, pareja, donde vive).
//  - GREETING: cortesia/saludo ("como estas?", "que tal?").
// Texto ya normalizado (minusculas, sin acentos). Guard: si trae terminos de negocio/trabajo, no es social.
function detectPersonalQuestion(normalized: string): ModelConversationOutput["pendingPersonalQuestion"] {
  if (
    /\b(agencia|rose|contrato|porcentaje|reparto|servicio|trabaj|gana|pag[ao]|onlyfans|\bof\b|movil|cliente|publico|comprador|pais)\b/.test(
      normalized
    )
  )
    return null;

  if (
    /\b(tu|vos)\b[^.!?]{0,14}\b(cuantos anos|que edad|casad|novi|parej|vives|hijos)\b/.test(normalized) ||
    /\b(cuantos anos|que edad)\b[^.!?]{0,14}\b(tu|vos)\b/.test(normalized)
  )
    return { kind: "RECIPROCAL_PERSONAL" };

  if (
    /\b(quien|kien)\s+(eres|sos|sois)\b/.test(normalized) ||
    /\bcomo te llamas\b/.test(normalized) ||
    /\bde donde\s+(eres|sos|sois)\b/.test(normalized) ||
    /\by\s+(tu|vos)\b\s*\??\s*$/.test(normalized) ||
    /^\s*(y\s+)?(tu|vos)\s*\??\s*$/.test(normalized)
  )
    return { kind: "IDENTITY" };

  if (/\b(como estas|como andas|como te va|como va todo|que tal)\b/.test(normalized)) return { kind: "GREETING" };

  return null;
}

function baseOutput(
  intent: ModelConversationOutput["intent"],
  extractedData: ModelConversationOutput["extractedData"],
  confidence: number,
  requiresHumanReview: boolean,
  humanReviewReason: string | null,
  internalNotes: string[],
  pendingPersonalQuestion: ModelConversationOutput["pendingPersonalQuestion"] = null
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
    pendingPersonalQuestion,
    relevantTopics: [],
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
