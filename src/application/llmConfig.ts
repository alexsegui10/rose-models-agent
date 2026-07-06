import { AutomationModeSchema, type AutomationMode } from "@/domain/automation";

export type LlmMode = "DETERMINISTIC" | "OPENAI";

export interface LlmRuntimeConfig {
  llmMode: LlmMode;
  automationMode: AutomationMode;
  openaiApiKey?: string;
  understandingModel: string;
  writingModel: string;
  /** Modelo del REDACTOR de la llamada de voz: separado del de texto porque la voz exige latencia baja. */
  callWritingModel: string;
  timeoutMs: number;
  maxRetries: number;
}

// gpt-4.1-mini fue deslistado por OpenAI (su variante nano se apaga el 23-oct-2026).
// COMPRENSION en mini a proposito: es extraccion estructurada (rapida y barata) y va fusionada con el
// extractor determinista; subirla no mejora la voz del bot y si la latencia. Va antes que la redaccion.
const defaultUnderstandingModel = "gpt-5.4-mini";
// REDACCION de texto en gpt-5.4 COMPLETO (Alex 6-jul): suena mas natural, empatiza mejor y sostiene el
// contexto -> es la mayor palanca de "estar vivo", justo lo que Alex pedia. Antes se creia que en Vercel
// HOBBY el techo por funcion era ~10s y el gpt-5.4 (lento, ~3-5s) se pasaba del timeout -> fallback
// robotico. FALSO: Hobby permite maxDuration hasta 60s (300s con Fluid Compute). El cuello real era
// NUESTRO tope interno de 4s (ver timeoutMs abajo) + los presupuestos de rafaga de ~9s del webhook,
// calibrados para aquel 10s viejo. Subidos ambos, el grande cabe de sobra tambien en Hobby.
const defaultWritingModel = "gpt-5.4";
// La LLAMADA de voz se queda en mini: cada turno tiene que salir en <3.5s o la llamada se siente muerta.
const defaultCallWritingModel = "gpt-5.4-mini";

export function getLlmRuntimeConfig(env: NodeJS.ProcessEnv = process.env): LlmRuntimeConfig {
  const requestedMode = env.LLM_MODE === "OPENAI" ? "OPENAI" : "DETERMINISTIC";
  const openaiApiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const llmMode: LlmMode = requestedMode === "OPENAI" && openaiApiKey ? "OPENAI" : "DETERMINISTIC";
  const automationMode = AutomationModeSchema.catch("HUMAN_APPROVAL").parse(env.AUTOMATION_MODE);

  return {
    llmMode,
    automationMode,
    openaiApiKey,
    understandingModel: env.OPENAI_UNDERSTANDING_MODEL?.trim() || defaultUnderstandingModel,
    writingModel: env.OPENAI_WRITING_MODEL?.trim() || defaultWritingModel,
    callWritingModel: env.OPENAI_CALL_MODEL?.trim() || defaultCallWritingModel,
    // Default 12s / 0 reintentos (6-jul, corregido): Vercel Hobby permite hasta 60s por funcion (no ~10s
    // como se creia), asi que el gpt-5.4 de redaccion (~3-8s) cabe con margen. El voz se auto-limita a
    // 3.5s aparte (openaiCallDrafter) y la comprension-mini es rapida y no gasta este tope; el peor caso
    // (ambas llamadas colgadas) ~24s sigue bajo los 60s. 0 reintentos: un fallo ya cae al fallback determinista.
    timeoutMs: positiveNumber(env.OPENAI_TIMEOUT_MS, 12000),
    maxRetries: nonNegativeNumber(env.OPENAI_MAX_RETRIES, 0)
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Para valores donde el 0 es VALIDO (p. ej. "0 reintentos"): positiveNumber trataba "0" como invalido y
// caia al fallback, con lo que OPENAI_MAX_RETRIES=0 en Vercel no surtia efecto (bug jul-2026).
function nonNegativeNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
