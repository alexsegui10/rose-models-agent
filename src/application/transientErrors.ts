/**
 * Clasificación de errores de INFRAESTRUCTURA (red/BD), en un solo sitio para que no vuelvan a divergir dos
 * copias (lo que pasó: el webhook tenía 08006/08001 y el store 28000/28P01, cada uno sin los del otro).
 *
 * OJO: son DOS predicados con semántica DISTINTA a propósito — NO es una única "unión":
 *  - `isRetriableTransientError`: ¿devolver 5xx para que META REINTENTE el webhook? Amplio (incluye la regex de
 *    mensaje y los 08xxx de conexión), pero EXCLUYE los de credenciales/config (28000/28P01/3D000): reintentar
 *    un error de contraseña o base inexistente sería un bucle infinito, no se arregla solo.
 *  - `isDatabaseUnavailableError`: ¿caer al repositorio EN MEMORIA porque no se puede hablar con la BD? Incluye
 *    los de credenciales/config (si la config está rota, mejor memoria que romperse), y va SOLO por código
 *    (sin regex de mensaje), más conservador para no caer a memoria por un error de datos.
 *
 * Los códigos COMUNES viven una sola vez (SHARED_CONNECTION_CODES); cada predicado añade los suyos.
 * Puro, sin I/O. Comportamiento idéntico al que había en webhook/route.ts y simulatorStore.ts (con tests).
 */

/** Señales de socket/red y de conexión de postgres.js compartidas por ambos predicados. */
export const SHARED_CONNECTION_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "57P03"
]);

// Extra del webhook (transitorio-reintentable): connection exceptions de postgres. NO incluye credenciales.
const RETRIABLE_EXTRA_CODES = new Set(["08006", "08001", "08004"]);
// Extra del store (BD no disponible): credenciales/autenticación/base inexistente -> caer a memoria.
const DB_UNAVAILABLE_EXTRA_CODES = new Set(["28000", "28P01", "3D000"]);

const TRANSIENT_MESSAGE_RE =
  /(econn|etimedout|connect_timeout|connection|fetch failed|socket|terminat|too many connections|timeout)/i;

function hasCode(error: object, codes: ReadonlySet<string>): boolean {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && codes.has(code);
}

/**
 * ¿Es un error TRANSITORIO que justifica un 5xx para que Meta reintente el webhook? (comportamiento EXACTO del
 * antiguo `isLikelyTransientError`: códigos compartidos + 08xxx + regex de mensaje + AggregateError + cause,
 * profundidad máx. 8). Un error de datos/lógica NO entra aquí.
 */
export function isRetriableTransientError(error: unknown, depth = 0): boolean {
  if (depth > 8 || typeof error !== "object" || error === null) return false;
  if (hasCode(error, SHARED_CONNECTION_CODES) || hasCode(error, RETRIABLE_EXTRA_CODES)) return true;
  const message = (error as { message?: unknown }).message;
  if (typeof message === "string" && TRANSIENT_MESSAGE_RE.test(message)) return true;
  if (error instanceof AggregateError && error.errors.some((inner) => isRetriableTransientError(inner, depth + 1))) {
    return true;
  }
  return isRetriableTransientError((error as { cause?: unknown }).cause, depth + 1);
}

/**
 * ¿No se puede hablar con la BD configurada (incluida config/credenciales rotas) y conviene caer al repositorio
 * EN MEMORIA? (comportamiento EXACTO del antiguo `isConnectionError`: códigos compartidos + credenciales +
 * AggregateError + cause, profundidad máx. 10, SIN regex de mensaje). Un error de datos (p. ej. 23505) NO entra.
 */
export function isDatabaseUnavailableError(error: unknown, depth = 0): boolean {
  if (depth > 10 || typeof error !== "object" || error === null) return false;
  if (hasCode(error, SHARED_CONNECTION_CODES) || hasCode(error, DB_UNAVAILABLE_EXTRA_CODES)) return true;
  if (error instanceof AggregateError && error.errors.some((inner) => isDatabaseUnavailableError(inner, depth + 1))) {
    return true;
  }
  return isDatabaseUnavailableError((error as { cause?: unknown }).cause, depth + 1);
}
