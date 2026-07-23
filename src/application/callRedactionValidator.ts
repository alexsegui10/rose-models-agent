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
import { promisesFaceConcealment } from "./faceConcealment";

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
  /**
   * Turno de HANDOFF (pasar al socio): el bot NO fija CUANDO contactara Alex — esa promesa de tiempo la fija
   * Alex, no el bot (invariante 4, la decision humana es suya). Con esto en true se veta cualquier referencia
   * temporal CONCRETA de contacto ("te llama manana a las 10", "el lunes", "en 20 minutos"); las vagas
   * ("enseguida", "en un ratito", "pronto") pasan. Asi la promesa de tiempo la corta la red, no solo el prompt.
   */
  noContactTimePromise?: boolean;
  /**
   * Turno de DEFER (no sabemos la respuesta): el draft NO puede EMPEZAR con "Sí"/"No" — ante una pregunta
   * polar eso equivale a RESPONDERLA y contradice el defer en el mismo turno ("No, tranquila... eso prefiero
   * confirmártelo" dejaba en el aire a una madre preguntando por sus hijos — sweep R9 10-jul). Con esto en
   * true, una partícula polar inicial tira el draft al fallback (que arranca con "Mira/Pues", neutro).
   */
  noPolarOpener?: boolean;
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
  /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci(?:seis|siete|ocho|nueve)|veinte|veinti\w+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?s?|doscient[oa]s|trescient[oa]s|cuatrocient[oa]s|quinient[oa]s|seiscient[oa]s|setecient[oa]s|ochocient[oa]s|novecient[oa]s|mil(?:es)?|millon(?:es)?)\b/;
// [oa]s en las centenas (23-jul): "quinientAs lucas / doscientAs lucas" (moneda femenina AR) se colaba.

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

  // La CARA es un requisito DURO: ningún turno de voz puede prometer anonimato / difuminar / tapar / "sin
  // mostrar la cara" (mismo guard que la ruta de texto, compartido en faceConcealment.ts). SIEMPRE activo:
  // es justo en el turno de reconducir la cara (RECONDUCT_FACE, redactado por LLM) donde el modelo podría
  // alucinar una salida de anonimato — el prompt lo desaconseja pero la RED lo garantiza (bloqueante revisor
  // 8-jul: la voz no tenía este guard, solo el texto). Una reafirmación ("la cara es imprescindible") pasa.
  if (promisesFaceConcealment(trimmed)) {
    return { valid: false, reason: "promete ocultar/difuminar la cara o anonimato (la cara es imprescindible)" };
  }

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

  // GÉNERO: el bot es Alex (HOMBRE) y la agencia se dice "nosotros"; un "nosotras" (o equipo en femenino)
  // es un tell de IA (barrido voz 16-jul, nº3: el redactor LLM soltaba "nosotras"). Se rechaza -> fallback
  // determinista (que dice "nosotros"). "las chicas" (las MODELOS, que sí son mujeres) NO se toca: solo la
  // auto-referencia del equipo en femenino ("nosotras", "estamos/somos todas").
  if (/\bnosotras\b|\b(?:estamos|somos)\s+todas\b(?!\s+(?:las|los)\b)/.test(norm)) {
    return { valid: false, reason: "voz de la agencia en femenino (el bot es Alex, masculino)" };
  }

  // 3ª PERSONA / lenguaje del funnel de TEXTO en la llamada: el bot ES Alex, así que hablar de "el chatbot"
  // o de "la revisión humana/manual" delata la IA (barrido voz 16-jul, nº2). El conocimiento ya se reescribe
  // a 1ª persona en la capa de voz (callRedaction.VOICE_FIRST_PERSON); esto es la RED por si el modelo lo
  // suelta igual -> fallback determinista. "reviso yo / la revisión del perfil" (1ª persona) sí pasa.
  if (/\b(?:el|un|del|al) chatbot\b|\bel bot\b|\brevision (?:humana|manual)\b/.test(norm)) {
    return { valid: false, reason: "lenguaje de chatbot / 3ª persona en la llamada (el bot es Alex)" };
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
  // PARÁFRASIS de la inversión (workflow 20-jul + revisor: "te quedas con el 70", "te llevas el setenta",
  // "es tuyo el 70", "el 70 lo cobras vos"): la guarda de arriba solo cazaba "N para ti/vos". Ventana corta
  // ({0,15}) para NO cazar el flujo de cobro legítimo ("...70% para la agencia... el dinero lo cobras tú",
  // que queda lejos y sin cifra pegada). "te quedas con el 30" (dirección correcta) NO se toca.
  if (
    /\b(?:te\s+(?:quedas?|llevas?|tocas?)|es\s+tuyo|tu\s+parte\s+(?:es|seria))\b[^.!?]{0,15}\b(?:70|65|60|setenta|sesenta)\b/.test(
      norm
    ) ||
    /\b(?:70|65|60|setenta|sesenta)\b[^.!?]{0,15}\b(?:te\s+(?:quedas?|llevas?)|lo\s+cobras\s+(?:tu|vos)|es\s+tuyo|es\s+para\s+tu\s+parte)\b/.test(
      norm
    )
  ) {
    return { valid: false, reason: "reparto invertido parafraseado (la parte grande no es para ella)" };
  }
  if (
    /\b(?:nos\s+(?:quedamos|llevamos)|la\s+agencia\s+se\s+(?:queda|lleva))\b[^.!?]{0,15}\b(?:30|35|40|treinta|cuarenta)\b/.test(
      norm
    )
  ) {
    return { valid: false, reason: "reparto invertido parafraseado (la parte pequeña no es para la agencia)" };
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

  // NUMERAL EN LETRA pegado a MONEDA ("quinientos euros al mes"): SIEMPRE inválido, en CUALQUIER turno
  // (workflow 20-jul: el candado fuerte solo corría en GIVE_EARNINGS y un turno de REASSURE/etapa podía
  // prometer "quinientos euros al mes" sin dígitos). Un numeral-en-letra junto a moneda jamás es cadencia
  // de contenido legítima.
  if (
    new RegExp(`${EARNINGS_NUMERAL_WORDS.source}\\s+(?:euros?|dolar(?:es)?|pavos?|lucas?|palos?|mangos?|libras?|pesos?)\\b`).test(
      norm
    )
  ) {
    return { valid: false, reason: "cifra de dinero en letra (promesa de ingresos)" };
  }

  // Turno de DINERO (allowAuthorizedShare): ningún número de 3+ dígitos es legítimo presentando el reparto
  // (revisor 23-jul: "algunas sacan entre 1000 y 3000" pasaba sin % ni moneda). Los autorizados son de 2.
  if (options?.allowAuthorizedShare === true && /\b\d{3,}\b/.test(norm)) {
    return { valid: false, reason: "número grande en el turno de dinero" };
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

  // Turno de DEFER: no puede EMPEZAR con "Sí"/"No" (responderia la pregunta que esta difiriendo). Sobre el
  // texto NORMALIZADO (sin acentos): "Sí," con tilde rompe el \b de la regex cruda.
  if (options?.noPolarOpener) {
    if (/^\s*¡?¿?\s*(?:si|no)\b/.test(norm)) {
      return { valid: false, reason: "empieza con Sí/No en un turno de defer (contradice el defer)" };
    }
  }

  // Turno de HANDOFF: veta prometer CUANDO contactara Alex (referencia temporal CONCRETA). Las vagas
  // ("enseguida", "en un ratito", "pronto") pasan; las concretas (dia/hora/en N min) caen al fallback.
  if (options?.noContactTimePromise) {
    if (
      /\b(?:manana|pasado manana|hoy|esta (?:tarde|noche|manana)|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|a las?\s*\d{1,2}|en\s*\d+\s*(?:min\w*|hora|horas|dia|dias)|dentro de\s*\d|en (?:media|una) hora|en un par de (?:horas|dias|minutos))\b/.test(
        norm
      )
    ) {
      return { valid: false, reason: "promesa de cuando contactara (la fija Alex, no el bot)" };
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
