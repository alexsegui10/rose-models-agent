/**
 * Validador de la redacción de VOZ. Cuando el LLM redacta (a partir del `draftingBrief`), su salida PASA
 * por aquí antes de decirse. Si la viola, se descarta y se usa el `fallbackText` determinista (invariante
 * 6). Es la red de seguridad que protege los invariantes cuando habla el modelo:
 *  - Invariante 3: ningún porcentaje de reparto fuera de los autorizados (70/65/60 y complementarios),
 *    NI en dígitos NI en palabras ("ochenta por ciento", "fifty fifty", "a medias").
 *  - No prometer/cuantificar ingresos: nada de cifras de dinero ni "al mes/semana", ni "se gana bien",
 *    "te forras", "dinero fácil", "ingresos asegurados/garantizados", etc.
 *  - Turnos de voz BREVES (no monólogos).
 *
 * Es deliberadamente CONSERVADOR: ante la duda, invalida y deja hablar al fallback seguro.
 */

import type { CallDraftingBrief } from "./callRedaction";

export interface CallValidationResult {
  valid: boolean;
  reason?: string;
}

export interface CallValidationOptions {
  /**
   * ¿Puede este turno mencionar cifras del reparto (las autorizadas)? SOLO el turno de dinero (COVER_STAGE
   * de MONEY) debería; en el resto de turnos redactados (defer, identidad, otras etapas, respuestas) una
   * cifra de reparto está FUERA DE SITIO aunque sea "correcta" (endurecimiento R1 jul-2026: el director no
   * decidió comunicarla ahí). Por defecto true (compatibilidad con los textos deterministas ya validados).
   */
  allowAuthorizedShare?: boolean;
  /**
   * ¿Puede este turno despedirse/cerrar? Los turnos REDACTADOS por el LLM son siempre turnos intermedios
   * (los cierres son deterministas): una despedida improvisada ("no podemos trabajar contigo, un saludo")
   * suena a fin de llamada sin que el director haya cerrado (barrido jul-2026). Por defecto true
   * (los textos deterministas de cierre/despedida sí se despiden, obviamente).
   */
  allowFarewell?: boolean;
  /**
   * Turno de INGRESOS ("cuanto se gana"): NINGUN numero es legitimo (la respuesta honesta es "depende de ti,
   * sin cifras"). Con esto en true se rechaza CUALQUIER digito o magnitud de dinero, cerrando los huecos del
   * eje de ingresos (numero desnudo "entre 1000 y 3000", "30 al dia", "50 pavos", que las reglas normales no
   * cazan). Asi, al redactar GIVE_EARNINGS con el LLM, una cifra JAMAS se dice -> cae al fallback determinista
   * (invariante de ingresos intacto; "nunca ir a menos" respecto al texto fijo de antes). Por defecto false.
   */
  noMoneyFigures?: boolean;
}

/** Porcentajes (en dígitos) que el bot PUEDE decir: la escalera autorizada y sus complementarios. */
const AUTHORIZED_SHARE = new Set([70, 65, 60, 30, 35, 40]);
/** Porcentajes en PALABRAS permitidos (mismos valores). */
const ALLOWED_PCT_WORDS = new Set(["setenta", "sesenta", "sesenta y cinco", "treinta", "treinta y cinco", "cuarenta"]);
/** Palabras que SON un numeral (para detectar "X por ciento" en letra). */
const NUMBER_WORDS = new Set([
  "cero",
  "cinco",
  "diez",
  "quince",
  "veinte",
  "veinticinco",
  "treinta",
  "treinta y cinco",
  "cuarenta",
  "cuarenta y cinco",
  "cincuenta",
  "cincuenta y cinco",
  "sesenta",
  "sesenta y cinco",
  "setenta",
  "setenta y cinco",
  "ochenta",
  "ochenta y cinco",
  "noventa",
  "noventa y cinco",
  "cien",
  "ciento"
]);

// Cualquier NUMERAL en palabras, para el candado de INGRESOS (noMoneyFigures). Regex morfologica COMPLETA y
// autonoma (0-99 + cientos/miles/millon): en un turno de "cuanto se gana" ningun numeral es legitimo (no hay
// cadencia de contenido ahi), asi que se vetan TODOS -> cualquier cifra tira el draft al fallback. Se EXCLUYEN
// a proposito "un/uno/una" y "cero": son articulo/pronombre/muletilla ("una cifra", "uno nunca sabe", "cero
// problema") que romperian respuestas honestas; y "un euro" ya lo caza la regla de moneda de mas abajo. Se hizo
// autonoma (no reutiliza NUMBER_WORDS) porque ese set es incompleto en unidades/adolescentes (revisor 7-jul).
const EARNINGS_NUMERAL_WORDS =
  /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci(?:seis|siete|ocho|nueve)|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?s?|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos|mil(?:es)?|millon(?:es)?)\b/;

const MAX_UTTERANCE_LENGTH = 600;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function validateCallUtterance(
  text: string,
  _brief?: CallDraftingBrief,
  options?: CallValidationOptions
): CallValidationResult {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) return { valid: false, reason: "vacío" };
  if (trimmed.length > MAX_UTTERANCE_LENGTH) return { valid: false, reason: "demasiado largo para un turno de voz" };

  const norm = normalize(trimmed);

  // El bot JAMÁS afirma ser humano ni niega ser una IA (barrido jul-2026: "¿eres un robot?" acabó en
  // "Soy una persona, tranquila"). Se rechaza en cualquier draft; el fallback de identidad no miente.
  // Cubre artículos y variantes ("soy un humano", "no soy ningún robot", "soy real") — huecos del revisor.
  if (
    /\bsoy (?:un |una )?(?:persona|human[oa]|ser humano)\b|\bno soy (?:un |una |ning\w+ )?(?:robot|bot|maquina|ia|inteligencia)\b|\bde carne y hueso\b|\bsoy (?:un )?(?:chico|hombre|tio) de verdad\b|\bsoy (?:real|de verdad)\b/.test(
      norm
    )
  ) {
    return { valid: false, reason: "afirma ser humano / niega ser IA" };
  }

  // Despedidas improvisadas en turnos intermedios: cerrar la llamada lo decide el DIRECTOR, no el LLM.
  if (options?.allowFarewell === false) {
    if (
      /\bun saludo\b|\bque te vaya (?:bien|genial|bonito)\b|\badios\b|\bhasta (?:luego|pronto)\b|\bcha[ou]\b|\bnos vemos\b|\bun abrazo\b|\bun beso\b|\bte deseo lo mejor\b|\bgracias por tu tiempo\b|\bque tengas (?:buen|un buen)\b/.test(
        norm
      )
    ) {
      return { valid: false, reason: "despedida improvisada (el cierre lo decide el director)" };
    }
  }

  // INVERSIÓN del reparto (bug histórico "ese 70 es para ti", ahora también posible vía drafter): la parte
  // GRANDE (70/65/60) jamás es para ELLA, y la pequeña (30/35/40) jamás para la agencia. Se rechaza aunque
  // las cifras sean "autorizadas" (endurecimiento R1 jul-2026).
  if (/\b(?:70|65|60|setenta|sesenta y cinco|sesenta)\s*(?:%|por\s?ciento)?\s*(?:es\s+)?para\s+(?:ti|vos)\b/.test(norm)) {
    return { valid: false, reason: "reparto invertido (la parte grande no es para ella)" };
  }
  if (
    /\b(?:30|35|40|treinta|treinta y cinco|cuarenta)\s*(?:%|por\s?ciento)?\s*(?:es\s+)?para\s+(?:nosotros|la agencia)\b/.test(
      norm
    )
  ) {
    return { valid: false, reason: "reparto invertido (la parte pequeña no es para la agencia)" };
  }

  // Cifras del reparto FUERA del turno de dinero: si este turno no debía hablar de cifras (defer,
  // identidad, otras etapas), CUALQUIER porcentaje o reparto N/N invalida, aunque sea el autorizado.
  if (options?.allowAuthorizedShare === false) {
    if (/\b\d{1,4}\s*(?:%|por\s?ciento)/.test(norm) || /\b\d{1,3}\s*[/-]\s*\d{1,3}\b/.test(norm)) {
      return { valid: false, reason: "porcentaje fuera del turno de dinero" };
    }
    for (const match of norm.matchAll(/([a-z]+(?:\s+y\s+cinco)?)\s+por\s?ciento/g)) {
      if (NUMBER_WORDS.has(match[1].trim())) {
        return { valid: false, reason: "porcentaje fuera del turno de dinero" };
      }
    }
  }

  // Porcentajes en DÍGITOS ("80%", "1000 por ciento"): solo los autorizados (admite 1-4 dígitos para que
  // un número grande también se rechace).
  for (const match of norm.matchAll(/\b(\d{1,4})\s*(?:%|por\s?ciento)/g)) {
    if (!AUTHORIZED_SHARE.has(Number(match[1]))) {
      return { valid: false, reason: `porcentaje no autorizado: ${match[1]}` };
    }
  }

  // Porcentajes en PALABRAS ("ochenta por ciento", "sesenta y cinco por ciento"): solo los autorizados.
  for (const match of norm.matchAll(/([a-z]+(?:\s+y\s+cinco)?)\s+por\s?ciento/g)) {
    const word = match[1].trim();
    if (NUMBER_WORDS.has(word) && !ALLOWED_PCT_WORDS.has(word)) {
      return { valid: false, reason: `porcentaje no autorizado (en palabras): ${word}` };
    }
  }

  // Reparto "N/N" o "N-N": ambos lados deben ser autorizados.
  for (const match of norm.matchAll(/\b(\d{1,3})\s*[/-]\s*(\d{1,3})\b/g)) {
    if (!AUTHORIZED_SHARE.has(Number(match[1])) || !AUTHORIZED_SHARE.has(Number(match[2]))) {
      return { valid: false, reason: `reparto no autorizado: ${match[0]}` };
    }
  }

  // Reparto al 50/50 expresado de otras formas.
  if (/\bfifty\b|\bmitad y mitad\b|\ba medias\b|\bal cincuenta\b|\bcincuenta y cincuenta\b/.test(norm)) {
    return { valid: false, reason: "reparto no autorizado (50/50)" };
  }

  // Turno de INGRESOS: barrera ABSOLUTA. Ningun numero es legitimo respondiendo "cuanto se gana" -> se rechaza
  // cualquier digito o magnitud de dinero (cierra "entre 1000 y 3000", "30 al dia", "50 pavos", numero desnudo).
  if (options?.noMoneyFigures) {
    // "un/una/unos + moneda" (euro/dolar y coloquiales AR: pavo/luca/palo/billete/mango): la regla general de
    // moneda de mas abajo exige un DIGITO, asi que "un euro al dia" / "una luca al mes" se colaban. Aqui se veta
    // sin romper "un tema"/"una cifra"/"uno nunca sabe" (no llevan unidad monetaria detras).
    const wordQuantifiedMoney =
      /\b(?:un|una|uno|unos|unas)\s+(?:euros?|dolar(?:es)?|pavos?|lucas?|palos?|billetes?|libras?|mangos?)\b/;
    if (/\d/.test(norm) || EARNINGS_NUMERAL_WORDS.test(norm) || wordQuantifiedMoney.test(norm)) {
      return { valid: false, reason: "cifra en turno de ingresos" };
    }
  }

  // Cifras de dinero (con símbolo/moneda) y miles asociados a dinero/tiempo.
  if (/\d[\d.,]*\s*(?:€|euros?|eur\b|dolar(?:es)?|usd|\$)/.test(norm)) {
    return { valid: false, reason: "cifra de dinero" };
  }
  if (/\b(mil(?:es)?|millon(?:es)?)\b[^.?!]{0,15}\b(?:euros?|al mes|mensual|semana|semanal|pasta|dinero)\b/.test(norm)) {
    return { valid: false, reason: "miles de dinero" };
  }

  // Ingreso periódico cuantificado: una cifra GRANDE (>=3 dígitos, p.ej. 3000) + "al mes/semana", en
  // cualquier orden. Las cifras pequeñas con "al día/semana" son CADENCIA de contenido ("2-3 fotos al
  // día", "10-20 reels a la semana"), NO ingresos, así que no se tocan.
  if (/\b\d{3,}[\d.,]*\b[^.?!]{0,12}\b(?:al mes|a la semana|mensual(?:es)?|semanal|por mes)\b/.test(norm)) {
    return { valid: false, reason: "ingreso periódico cuantificado" };
  }
  if (/\b(?:al mes|a la semana|mensual|semanal|por mes)\b[^.?!]{0,12}\b\d{3,}/.test(norm)) {
    return { valid: false, reason: "ingreso periódico cuantificado" };
  }

  // Promesas de ingresos (sin cifra): "te forras", "se gana bien", "ganar mucho/dinero", "dinero fácil",
  // "ingresos asegurados/garantizados".
  if (/\b(?:te vas a |)forr\w*|\bpastizal\b|\bdineral\b/.test(norm)) {
    return { valid: false, reason: "promesa de ingresos" };
  }
  if (
    /\bganar\w*\s+(?:mucho|muchisimo|much[ií]simo|bastante|un monton|una pasta|un dineral|dinero|pasta|euros)\b|\b(?:dinero|pasta)\s+facil\b/.test(
      norm
    )
  ) {
    return { valid: false, reason: "promesa de ingresos" };
  }
  if (/\bse gana\b[^.?!]{0,15}\b(?:bien|mucho|muchisimo|pasta|dinero|un monton)\b/.test(norm)) {
    return { valid: false, reason: "promesa de ingresos" };
  }
  if (
    /\bingres\w*[^.?!]{0,15}\b(?:asegurad|garantizad|fij[oa])\w*\b|\b(?:asegurad|garantizad)\w*[^.?!]{0,15}\bingres/.test(norm)
  ) {
    return { valid: false, reason: "ingresos asegurados/garantizados" };
  }
  if (/\bdinero\s+(?:asegurad|garantizad|seguro|fij[oa])\w*\b/.test(norm)) {
    return { valid: false, reason: "dinero asegurado" };
  }

  return { valid: true };
}
