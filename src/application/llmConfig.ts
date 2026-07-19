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
  /**
   * REDACCION VIA SUSCRIPCION (opcional, decision de Alex 19-jul): si esta la URL del proxy del VPS, la
   * redaccion de texto la intenta PRIMERO por ahi (terra por la cuota plana de ChatGPT, coste 0) y cae a la
   * API ante cualquier fallo. Ausente = comportamiento actual 100% API. Nunca afecta a la comprension ni a la voz.
   */
  subscriptionBaseUrl?: string;
  subscriptionApiKey?: string;
  subscriptionModel?: string;
}

// gpt-4.1-mini fue deslistado por OpenAI (su variante nano se apaga el 23-oct-2026).
// COMPRENSION en mini a proposito: es extraccion estructurada (rapida y barata) y va fusionada con el
// extractor determinista; subirla no mejora la voz del bot y si la latencia. Va antes que la redaccion.
const defaultUnderstandingModel = "gpt-5.4-mini";
// REDACCION de texto en gpt-5.6-terra (Alex 18-jul, comparacion lado-a-lado con Daiana): empatiza y
// contextualiza NOTABLEMENTE mejor que gpt-5.4 al MISMO precio ("Entiendo que despues de que te cambiaran
// lo de Only por Stripchat quieras mirarlo bien" vs el generico del 5.4). La COMPRENSION sigue en mini
// (extraccion estructurada barata; los bugs de bucle/contexto son de codigo, no del modelo). Overridable
// por OPENAI_WRITING_MODEL: si esa var esta puesta en Vercel gana al default, hay que actualizarla alli.
const defaultWritingModel = "gpt-5.6-terra";
// La LLAMADA de voz sube a gpt-5.4 COMPLETO (medicion 7-jul): el banco de latencia (mini vs gpt-5.4 en turnos
// reales de llamada) dio gpt-5.4 en ~1.4s de mediana / ~1.6s el peor caso, MUY por debajo del tope de 3.5s por
// turno, y con una redaccion bastante mas natural y viva. No hizo falta streaming del LLM ni cambiar de
// proveedor. Overridable por OPENAI_CALL_MODEL; el tope de tiempo por turno es OPENAI_CALL_TIMEOUT_MS (def 3500).
const defaultCallWritingModel = "gpt-5.4";

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
    maxRetries: nonNegativeNumber(env.OPENAI_MAX_RETRIES, 0),
    // Vacio/ausente = apagado (100% API). Se activa poniendo la URL del proxy del VPS en Vercel.
    subscriptionBaseUrl: env.OPENAI_SUBSCRIPTION_BASE_URL?.trim() || undefined,
    // El proxy suele aceptar cualquier token (la auth real es el OAuth del VPS); "sk-proxy" por defecto.
    subscriptionApiKey: env.OPENAI_SUBSCRIPTION_API_KEY?.trim() || "sk-proxy-placeholder",
    // Modelo a pedir al proxy; por defecto el mismo que la redaccion de API (terra) -> misma calidad.
    subscriptionModel: env.OPENAI_SUBSCRIPTION_MODEL?.trim() || undefined
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
