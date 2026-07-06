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
// extractor determinista; subirla no mejora la voz del bot y si la latencia (Vercel Hobby ~10s/turno).
const defaultUnderstandingModel = "gpt-5.4-mini";
// REDACCION de texto en gpt-5.4-mini (Alex 6-jul, decision revisada): el gpt-5.4 COMPLETO suena mas
// natural PERO es lento (~3-5s) y en Vercel HOBBY (turno 8.5s, tope 4s/llamada) se pasa del timeout de
// forma INTERMITENTE -> cae al fallback determinista robotico "a veces si a veces no", justo lo que Alex
// odia. En Hobby, mini (rapido, consistente) + menos plantillas es mejor que gpt-5.4 intermitente. El
// grande queda a UN paso: en Vercel PRO (turno hasta 60s) hacer OPENAI_WRITING_MODEL=gpt-5.4 en el entorno.
const defaultWritingModel = "gpt-5.4-mini";
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
    // Default 4s / 0 reintentos (jul-2026): en Vercel Hobby el techo real por funcion es ~10s y un turno
    // hace DOS llamadas a OpenAI (comprension + redaccion); 8s+reintento reventaba el techo y mataba la
    // lambda ANTES de que el fallback determinista pudiera actuar. Override por env si algun dia hay mas techo.
    timeoutMs: positiveNumber(env.OPENAI_TIMEOUT_MS, 4000),
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
