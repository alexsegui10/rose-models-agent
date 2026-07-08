/**
 * Adaptador OpenAI de la CAPA DE COMPRENSIÓN de la llamada: implementa `CallUnderstander` pidiéndole al
 * modelo que CLASIFIQUE en una etiqueta lo que la candidata quiso decir cuando el oído determinista no lo
 * reconoció. Salida MÍNIMA (una etiqueta) para que sea rápido en una llamada en vivo.
 *
 * Seguridad (capas):
 *  - El prompt SOLO ofrece etiquetas que NO cambian el estado del director (pregunta/duda/identidad/
 *    ingresos/edad/aclaración/cara/none). El código nunca deja que el modelo avance, cierre, negocie ni
 *    transfiera (eso lo decide el director determinista) — ver callUnderstander.ts.
 *  - Ante timeout/fallo devuelve null -> el turno se queda `unclear` (pedir que repita). Invariante 6.
 *  - Activo por defecto con OPENAI_API_KEY; CALL_LLM_UNDERSTANDING=off lo apaga (modo determinista puro).
 *
 * El SDK de OpenAI vive aislado aquí (adaptador); el resto usa la interfaz CallUnderstander.
 */

import OpenAI from "openai";
import type { CallContext } from "./callContext";
import {
  parseUnderstoodIntent,
  type CallUnderstander,
  type CallUnderstandRequest,
  type CallUnderstoodIntent
} from "./callUnderstander";
import { getLlmRuntimeConfig } from "./llmConfig";

export interface OpenAiCallUnderstanderConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class OpenAiCallUnderstander implements CallUnderstander {
  private readonly client: OpenAI;

  constructor(
    private readonly config: OpenAiCallUnderstanderConfig,
    client?: OpenAI
  ) {
    this.client = client ?? new OpenAI({ apiKey: config.apiKey });
  }

  async understand(request: CallUnderstandRequest): Promise<CallUnderstoodIntent | null> {
    try {
      const response = await this.client.responses.create(
        {
          model: this.config.model,
          input: [{ role: "system", content: buildUnderstandPrompt(request) }],
          // Determinista (temp 0): clasificar es una tarea de etiqueta, no creativa; además reduce la
          // variación entre invocaciones. max_output_tokens holgado (256): la salida real es una palabra y
          // el modelo para solo; pero un tope bajo (p. ej. 8) o bien lo rechaza la API (mínimo 16) o bien el
          // modelo lo consume en tokens internos y devuelve vacío -> null -> unclear. Holgado no penaliza
          // latencia en una salida corta y deja margen si el modelo razona algo antes de emitir la etiqueta.
          temperature: 0,
          max_output_tokens: 256,
          truncation: "auto"
        },
        { signal: AbortSignal.timeout(this.config.timeoutMs) }
      );
      return parseUnderstoodIntent(response.output_text);
    } catch {
      // Timeout o error de red/API: null -> el turno se queda `unclear` (fallback determinista, invariante 6).
      return null;
    }
  }
}

/** Construye el prompt de clasificación: la frase, lo último que dijo el bot, y las etiquetas permitidas. */
export function buildUnderstandPrompt(request: CallUnderstandRequest): string {
  const lines: string[] = [];
  lines.push("Eres el 'oído' de Alex, de la agencia Rose Models, en una llamada de teléfono en español con una candidata.");
  lines.push(
    "El sistema no ha sabido clasificar automáticamente lo que ella acaba de decir. Tu ÚNICA tarea es entender QUÉ quiere y responder con UNA sola etiqueta de esta lista (sin explicar nada más):"
  );
  lines.push("- question: pregunta algo del negocio (cómo funciona, contenido, cuentas, contrato, tiempo, proceso...).");
  lines.push(
    "- distrust: CUALQUIER duda, reparo, miedo, vergüenza o inseguridad para dar el paso, aunque no sea una pregunta: que sea serio o una estafa, 'me da cosa/corte', el qué dirán, la pareja o la familia ('mi novio no sé si lo llevaría bien'), 'no sé si podré / si es para mí / si me atrevo', nervios o vértigo. NO es la cara (eso es face-concern)."
  );
  lines.push("- identity: pregunta quién eres, de qué agencia, o algo personal hacia ti (el que llama).");
  lines.push("- earnings: pregunta cuánto se gana / cuánto ganaría / si se gana bien.");
  lines.push("- age-policy: pregunta por la edad mínima / si hay que ser mayor de edad.");
  lines.push("- clarification: no entendió una palabra o parte de lo que TÚ acabas de decir y pide que se lo aclares.");
  lines.push(
    "- face-concern: duda, vergüenza o reparo sobre mostrar la CARA ('me da corte', 'soy tímida', 'y si me reconocen', 'no quiero salir de cara')."
  );
  lines.push(
    "- time-concern: duda sobre el TIEMPO o la disponibilidad para hacerlo ('trabajo y no sé si tendré tiempo', 'estudio', 'tengo hijos y poco tiempo', 'cuánto hay que dedicarle al día'). NO es la cara ni desconfianza de estafa."
  );
  lines.push("- none: no se entiende con seguridad, es ruido, o no encaja en nada de lo anterior.");
  if (request.lastBotUtterance && request.lastBotUtterance.trim().length > 0) {
    lines.push(`LO ÚLTIMO QUE DIJISTE TÚ (el bot): «${sanitize(request.lastBotUtterance)}»`);
  }
  if (request.context?.dmSummary) {
    lines.push(`CONTEXTO (del chat previo): ${sanitize(request.context.dmSummary)}`);
  }
  lines.push(`ELLA ACABA DE DECIR: «${sanitize(request.utterance)}»`);
  lines.push(
    "Responde SOLO con la etiqueta (una palabra de la lista). Si dudas entre varias, elige la más específica; si no encaja, 'none'."
  );
  return lines.join("\n");
}

function sanitize(text: string): string {
  // La cita entra a un prompt: se colapsan saltos de línea y se acota (una frase de voz real; menos
  // superficie de inyección). El mapeo posterior solo acepta etiquetas de la lista, así que aunque el
  // modelo intente "obedecer" texto inyectado, el parseo cae a null (unclear) si no es una etiqueta válida.
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

/**
 * Devuelve la capa de comprensión OpenAI, o undefined si no procede (sin clave, o CALL_LLM_UNDERSTANDING=off,
 * o CALL_LLM_REDACTION=off — sin redactor no tiene sentido "entender" mejor un turno que se dirá determinista).
 * Sin ella, la llamada se comporta como siempre (unclear -> pedir que repita). Los tests van así por defecto.
 */
export function getCallUnderstander(env: NodeJS.ProcessEnv = process.env): CallUnderstander | undefined {
  if (env.CALL_LLM_UNDERSTANDING === "off") return undefined;
  if (env.CALL_LLM_REDACTION === "off") return undefined;
  const config = getLlmRuntimeConfig(env);
  if (!config.openaiApiKey) return undefined;
  // Tope de tiempo propio: la comprensión corre ANTES del redactor en un turno no reconocido, así que se
  // le da un margen ajustado (clasificar una etiqueta es rápido) para no encadenar dos esperas largas.
  const rawTimeout = Number(env.OPENAI_CALL_UNDERSTAND_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 2500;
  return new OpenAiCallUnderstander({
    apiKey: config.openaiApiKey,
    // Modelo de COMPRENSIÓN mini por defecto (gpt-5.4-mini, el mismo que la comprensión del chat de texto):
    // clasificar en una etiqueta es tarea fácil, y al correr ANTES del redactor conviene que sea rápido para
    // no encadenar dos esperas largas en una llamada en vivo. Overridable por OPENAI_CALL_UNDERSTAND_MODEL.
    model: env.OPENAI_CALL_UNDERSTAND_MODEL || config.understandingModel,
    timeoutMs
  });
}
