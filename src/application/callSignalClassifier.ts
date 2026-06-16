/**
 * "Oído" del bot de llamada: convierte lo que dijo la candidata (texto de STT) en una señal
 * (`CallCandidateSignal`) que consume el director. Es DETERMINISTA y por patrones (castellano + algo de
 * LATAM porque hay candidatas de allí): rápido y sin LLM, lo que importa en una llamada en vivo.
 *
 * Decisiones de diseño:
 *  - La distinción pregunta CUBIERTA vs DESCONOCIDA NO la hace el patrón (sería frágil): el cerebro corre
 *    el recuperador de conocimiento y pasa `isCoveredQuestion`. Si es pregunta y no se sabe, se DEFIERE
 *    a Alex ("mi socio"), nunca se improvisa (por eso el defecto seguro es asks-unknown).
 *  - Distingue desconfianza LEVE (worried -> tranquilizar) de agresión/sospecha GRAVE (assertive ->
 *    handoff): "¿no será una estafa?" es distrust; "esto es una estafa, sois unos ladrones" es hostil.
 *  - Es best-effort y SUSTITUIBLE: el contrato con el director (la señal) es estable, así que más
 *    adelante se puede anteponer una capa LLM con fallback a esta sin tocar el director.
 *
 * Invariante 1: esto solo CLASIFICA; la decisión (qué hace el bot) la toma el director con la señal.
 */

import type { CallCandidateSignal } from "./callDirector";

export interface CallSignalInput {
  /** Lo último que dijo la candidata (texto de STT). */
  utterance: string;
  /**
   * Solo relevante cuando la frase es una PREGUNTA: ¿el conocimiento de negocio la cubre? Lo decide el
   * cerebro con el recuperador. Por defecto false → se defiere a Alex (nunca se improvisa una respuesta).
   */
  isCoveredQuestion?: boolean;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Agresión / sospecha GRAVE (assertive): insultos o acusaciones directas -> handoff.
const HOSTILE =
  /(es una? (estafa|timo|fraude|robo|secta)|sois unos? (estafadores|ladrones|mentirosos|sinverguenzas)|me estais enganando|esto es ilegal|os voy a denunciar|voy a (denunciar|llamar a la policia|llamar a la guardia)|idiota|imbecil|gilipollas|subnormal|cabron|payaso|capullo|hijo de|vete a la|callate|puta? (mierda|broma|bot)|pinche|estafadores)/;

// Pide hablar con una persona -> handoff.
const WANTS_HUMAN =
  /(hablar|hablo|hable|hablamos|hablarlo) con (una persona|alguien|un humano|una humana|alex|el jefe|tu jefe|el dueno|la duena|un responsable|un encargado|un agente real)|(no quiero|prefiero no|no me gusta) hablar con (un |una )?(bot|maquina|robot|grabacion|contestador|ia|inteligencia)|(pasame|ponme|me pasas|paseme) con (alex|una persona|alguien|un humano|el jefe)|(quiero|necesito|prefiero) (hablar con|que me llame) (una persona|alguien|alex|un humano)/;

// Términos de reparto/dinero (para la queja del %).
const SHARE_TERMS =
  /(\b30\b|treinta|comision|reparto|porcentaje|quedais|os queda|os llevais|se lleva|para la agencia|para vosotros|me queda(is)?|vuestra parte)/;
// Términos de queja (es mucho / bajadlo / poco para mí).
const COMPLAINT_TERMS =
  /(mucho|demasiado|caro|abusiv|es un robo|injust|no es justo|muy poco|poco para mi|bajad|bajar|bajais|podeis bajar|reducir|menos|no me sale|no me compensa|no me parece justo|es un palo|es un pasada)/;

// Desconfianza LEVE (worried) -> tranquilizar y seguir.
const DISTRUST =
  /(como se que (es|esto|sois|funciona)|como se si)|no me fio|me cuesta (creer|fiarme)|(sera|no sera|sera esto) (una )?(estafa|timo|broma)|(esto es|es esto|esto sera) (real|seguro|legal|de verdad|fiable|verdad)|es (de )?fiar|me da (cosa|miedo|reparo|cosica|repelus)|da (un poco de )?miedo|desconfi|no se si (fiarme|me fio|es verdad|esto es real)|(seguro que|de verdad) (es legal|me vais a pagar|esto funciona)/;

// Quiere terminar / colgar -> cerrar con contrato.
const WANTS_TO_END =
  /(te dejo|te tengo que dejar|tengo que (irme|colgar|dejarlo|dejarte)|hablamos (luego|mas tarde|otro dia|en otro momento|manana)|ahora no puedo|no es buen momento|me tengo que ir|tengo prisa|me pillas (mal|liada)|adios|hasta luego|me voy|cuelgo)/;

// ¿Es una pregunta?
const QUESTION =
  /\?\s*$|\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|porque|quien|para que)\b|(me puedes|puedes|podrias|podeis|me podeis|sabes|sabeis) (decir|explicar|contar|aclarar|mandar|ensenar|saber|si)|(tengo|una|otra) (duda|pregunta)/;

// Afirmaciones / asentimiento -> avanzar.
const FOLLOWS_ALONG =
  /^\s*(vale|ok|okay|oka|si+|claro|perfecto|genial|de acuerdo|entiendo|entendido|ajaja|aja|aha|ya|correcto|bien|guay|venga|estupendo|fenomenal|por supuesto|sip|sii+)\b|me parece (bien|genial|perfecto)|suena bien|me gusta|adelante|cuentame|dime|sigue/;

/** Clasifica lo dicho por la candidata en una señal para el director. */
export function classifyCallSignal(input: CallSignalInput): CallCandidateSignal {
  const text = normalize(input.utterance ?? "");
  if (text.length === 0) {
    return "none";
  }

  // Orden de prioridad: lo más urgente/seguro primero.
  if (HOSTILE.test(text)) return "hostile-or-suspicious";
  if (WANTS_HUMAN.test(text)) return "wants-human";
  if (SHARE_TERMS.test(text) && COMPLAINT_TERMS.test(text)) return "complains-about-share";
  if (DISTRUST.test(text)) return "distrust";
  if (WANTS_TO_END.test(text)) return "wants-to-end";
  if (QUESTION.test(text)) return input.isCoveredQuestion ? "asks-covered" : "asks-unknown";
  if (FOLLOWS_ALONG.test(text)) return "follows-along";

  // No reconocido: el bot sigue el guion (limitación conocida; una capa LLM lo afinaría).
  return "follows-along";
}
