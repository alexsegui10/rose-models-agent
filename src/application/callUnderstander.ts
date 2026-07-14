/**
 * Capa de COMPRENSIÓN de la llamada (jul-2026, decisión de Alex "que el bot piense y entienda TODO como el
 * chat de texto"): cuando el "oído" determinista (`classifyCallSignal`) NO reconoce una frase REAL (no ruido),
 * en vez de fingir mala línea ("no te he pillado, repíteme"), se le pide a un modelo que ENTIENDA qué quiso
 * decir la candidata y lo mapee a una intención del guion.
 *
 * SEGURIDAD / arquitectura (por qué esto es replay-safe y respeta el invariante 1):
 *  - La llamada es STATELESS: el estado se reconstruye REPRODUCIENDO los turnos por el clasificador
 *    determinista. Si el modelo pudiera cambiar el ESTADO (avanzar el guion, cerrar, negociar, handoff),
 *    la reproducción divergiría (el modelo no es determinista). Por eso la comprensión SOLO produce
 *    intenciones que NO cambian el estado del director: responder una pregunta, tranquilizar, aclarar,
 *    identidad, ingresos, edad, o una duda de la cara. NUNCA avanza etapa, cierra, negocia ni transfiere:
 *    esas decisiones (y edad/%/legal) siguen siendo 100% del código determinista.
 *  - Corre SOLO en el turno EN VIVO (no en la reproducción), así no mete N llamadas al LLM por invocación.
 *  - Ante fallo/timeout devuelve null -> el turno se queda como `unclear` (pedir que repita): fallback
 *    determinista intacto (invariante 6). El validador de voz sigue filtrando lo que se diga después.
 */

import type { CallCandidateSignal } from "./callDirector";
import type { CallContext } from "./callContext";

/**
 * Intención ENTENDIDA por el modelo, restringida a lo que NO cambia el estado del director (ver arriba).
 * "question" y "face-concern" las resuelve el responder con el conocimiento (cobertura / entrada de la cara).
 */
export type CallUnderstoodIntent =
  | "question" // pregunta de negocio -> el responder decide cubierta (responder) o no (deferir a WhatsApp)
  | "distrust" // duda / desconfianza / inseguridad -> tranquilizar y seguir
  | "identity" // pregunta quién es / algo personal al bot -> identidad con simpatía
  | "earnings" // cuánto se gana -> respuesta honesta sin cifras
  | "age-policy" // requisito de edad -> respuesta determinista (solo 18+)
  | "clarification" // no entendió una palabra/parte de lo que el BOT acaba de decir -> reformular en simple
  | "face-concern" // duda / vergüenza / reparo sobre mostrar la CARA -> tranquilizar con el conocimiento de la cara
  | "time-concern" // duda de TIEMPO / disponibilidad ("trabajo y no sé si tendré tiempo") -> responder el tiempo real
  | "smalltalk" // te cuenta algo o responde a lo que le preguntaste, sin pregunta ni objeción -> acusar y seguir
  | "none"; // no se entiende con seguridad -> se queda como unclear (pedir que repita)

export interface CallUnderstandRequest {
  /** Lo último que dijo la candidata (texto de STT) que el oído determinista no supo clasificar. */
  utterance: string;
  /** Lo ÚLTIMO que dijo el BOT (para distinguir "no entiendo ESO que dijiste" = clarification). */
  lastBotUtterance?: string;
  /** Contexto de la candidata (del DM): ayuda a interpretar. */
  context?: CallContext;
  /** Temas de la agenda ya tratados (etiquetas), para situar la frase. */
  coveredTopics?: string[];
}

export interface CallUnderstander {
  /** Devuelve la intención entendida, o null si no se pudo (timeout/fallo) -> el turno se queda unclear. */
  understand(request: CallUnderstandRequest): Promise<CallUnderstoodIntent | null>;
}

/** Etiquetas válidas que el modelo puede devolver (para validar su salida y para el prompt). */
export const CALL_UNDERSTOOD_INTENTS: readonly CallUnderstoodIntent[] = [
  "question",
  "distrust",
  "identity",
  "earnings",
  "age-policy",
  "clarification",
  "face-concern",
  "time-concern",
  "smalltalk",
  "none"
] as const;

/** Parsea la salida del modelo (una etiqueta) de forma tolerante; desconocido -> null (se queda unclear). */
export function parseUnderstoodIntent(raw: string | null | undefined): CallUnderstoodIntent | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().replace(/[^a-z-]/g, "");
  for (const intent of CALL_UNDERSTOOD_INTENTS) {
    if (cleaned.includes(intent)) return intent;
  }
  return null;
}

/**
 * Resultado del mapeo de una intención entendida a una señal del director. "question" y "face-concern"
 * necesitan conocimiento (cobertura / entrada de la cara), así que se marcan aparte para que el responder
 * las resuelva; el resto son señales directas NO-cambian-estado.
 */
export type RefinedSignalResolution =
  | { kind: "signal"; signal: CallCandidateSignal }
  | { kind: "question" } // el responder mira si el conocimiento la cubre (asks-covered) o no (asks-unknown)
  | { kind: "face-concern" } // el responder tranquiliza con la entrada de la cara (asks-covered forzado)
  | { kind: "time-concern" } // el responder responde con la entrada del tiempo de dedicación (asks-covered forzado)
  | { kind: "none" }; // no se entendió -> se queda unclear

/**
 * Mapea la intención entendida a una resolución. TODAS las señales resultantes son NO-cambian-estado
 * (asks-*, distrust): no avanzan el guion, no cierran, no negocian, no transfieren (invariante 1 + replay).
 */
export function resolveRefinedSignal(intent: CallUnderstoodIntent | null): RefinedSignalResolution {
  switch (intent) {
    case "question":
      return { kind: "question" };
    case "face-concern":
      return { kind: "face-concern" };
    case "time-concern":
      return { kind: "time-concern" };
    case "smalltalk":
      // Charla / respuesta sin intención de negocio: acusar con naturalidad y seguir (no cambia estado).
      return { kind: "signal", signal: "acknowledge" };
    case "distrust":
      return { kind: "signal", signal: "distrust" };
    case "identity":
      return { kind: "signal", signal: "asks-identity" };
    case "earnings":
      return { kind: "signal", signal: "asks-earnings" };
    case "age-policy":
      return { kind: "signal", signal: "asks-age-policy" };
    case "clarification":
      return { kind: "signal", signal: "asks-clarification" };
    case "none":
    case null:
    default:
      return { kind: "none" };
  }
}
