/**
 * Configuracion de QStash (Upstash): cola serverless para responder a la candidata DESPUES de una ventana
 * (dejarla terminar de escribir) sin que la funcion de Vercel se quede esperando (muere a los ~10s). Si
 * falta algo, queda DESACTIVADO (isConfigured=false) y el webhook responde al instante, como hasta ahora.
 * Secretos solo en .env.local / Vercel (gitignorado), nunca en codigo.
 */
export interface QStashConfig {
  isConfigured: boolean;
  token: string;
  url: string;
  currentSigningKey: string;
  nextSigningKey: string;
  /** Ventana de espera tras el ULTIMO mensaje de la candidata (ms). Default ~55s; ajustable por env. */
  debounceMs: number;
  /** Interruptor de activacion: INBOUND_DEBOUNCE=on. Apagado por defecto -> el bot responde al instante. */
  debounceEnabled: boolean;
}

const DEFAULT_DEBOUNCE_MS = 55000;

export function getQStashConfig(env: NodeJS.ProcessEnv = process.env): QStashConfig {
  const token = env.QSTASH_TOKEN?.trim() ?? "";
  const url = env.QSTASH_URL?.trim() || "https://qstash.upstash.io";
  const currentSigningKey = env.QSTASH_CURRENT_SIGNING_KEY?.trim() ?? "";
  const nextSigningKey = env.QSTASH_NEXT_SIGNING_KEY?.trim() ?? "";
  const parsed = Number(env.INBOUND_DEBOUNCE_MS ?? DEFAULT_DEBOUNCE_MS);
  const debounceMs = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEBOUNCE_MS;

  return {
    // Para PUBLICAR (programar) basta el token; para VERIFICAR el callback hacen falta las signing keys.
    isConfigured: Boolean(token && currentSigningKey && nextSigningKey),
    token,
    url,
    currentSigningKey,
    nextSigningKey,
    debounceMs,
    debounceEnabled: env.INBOUND_DEBOUNCE?.trim() === "on"
  };
}
