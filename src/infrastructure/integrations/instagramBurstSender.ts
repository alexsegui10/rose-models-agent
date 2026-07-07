/**
 * Emisor de RÁFAGA a Instagram: fuente ÚNICA para el webhook directo y para el flush del debounce.
 *
 * Reparte un PRESUPUESTO total de pausa "de tecleo" (ritmo humano) entre los huecos entre mensajes; si el
 * presupuesto se agota, las últimas burbujas salen SEGUIDAS en vez de perderse. Solo corta la ráfaga si se
 * acerca el techo DURO de tiempo por turno (margen holgado bajo los 60s de Vercel Hobby). Hace UN reintento
 * corto por chunk ante un fallo RÁPIDO (transitorio), para que un rechazo puntual de la API no tire toda la
 * ráfaga.
 *
 * POR QUÉ EXISTE (bug real Laura, 7-jul-2026): el flush tenía su PROPIA copia del bucle de envío con un
 * deadline hardcodeado de 9s (supuesto viejo del techo de Vercel de ~10s) y un retardo fijo por burbuja SIN
 * presupuesto repartido. Con el pitch de 6 burbujas eso enviaba solo ~4 y descartaba las 2 últimas ("En la
 * llamada te lo explico todo mejor" + "Si tienes cualquier duda me preguntas sin problema"): en el CRM salían
 * las 6 (las genera el motor) pero en Instagram solo llegaban 4. El webhook ya tenía la versión buena (32s +
 * presupuesto). Al unificar ambos caminos en este módulo, no vuelven a divergir.
 */

export interface BurstMessageProvider {
  sendTextMessage(recipientId: string, text: string): Promise<boolean>;
}

// Presupuesto TOTAL de pausa por turno, repartido entre los huecos entre mensajes. Ajustable por env.
const BURST_DELAY_BUDGET_MS = Number(process.env.INSTAGRAM_BURST_DELAY_BUDGET_MS ?? 4500);
const BURST_DELAY_PER_MESSAGE_MAX_MS = Number(process.env.INSTAGRAM_BURST_DELAY_MAX_MS ?? 3200);
// Techo de tiempo por turno con el que se calcula el presupuesto de pausas (60s Vercel Hobby). El presupuesto
// = min(BUDGET, TURN_TIME - lo ya gastado por OpenAI), para que la redacción tenga sitio y la ráfaga no se
// trunque por las pausas.
const TURN_TIME_BUDGET_MS = Number(process.env.INSTAGRAM_TURN_BUDGET_MS ?? 30000);
// Tope DURO: pasado este tiempo desde el inicio del turno, no se envían más chunks (margen holgado bajo 60s).
// Subido de los 9s hardcodeados del flush a 32s (el techo real de Hobby son 60s, confirmado 6-jul).
const HARD_TURN_DEADLINE_MS = Number(process.env.INSTAGRAM_HARD_DEADLINE_MS ?? 32000);
// Backoff antes de UN reintento de un chunk fallido (transitorio).
const BURST_RETRY_BACKOFF_MS = Number(process.env.INSTAGRAM_BURST_RETRY_BACKOFF_MS ?? 600);

/** Pausa "humana" antes de un mensaje: base + tiempo de tecleo según longitud, con tope por mensaje. */
function naturalSendDelayMs(chunk: string): number {
  const typingMs = 700 + chunk.trim().length * 28;
  return Math.min(typingMs, BURST_DELAY_PER_MESSAGE_MAX_MS);
}

function realSleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface BurstSendResult {
  /** Cuántos chunks se enviaron con éxito. */
  sent: number;
  /** Total de chunks que había que enviar. */
  total: number;
  /** true si se cortó la ráfaga antes de tiempo (deadline duro o chunk fallido tras reintento). */
  truncated: boolean;
}

export interface BurstSendOptions {
  /** Momento (ms) en que empezó el turno; se usa para el presupuesto de pausas y el deadline duro. */
  turnStartedAt: number;
  /** Prefijo de log (p. ej. "[ig-webhook]" / "[ig-flush]"); si se omite, no se loguea por chunk. */
  logPrefix?: string;
  /** Inyectables para tests deterministas (por defecto, reloj real y sleep real). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Envía `chunks` (una respuesta ya troceada en burbujas) a `recipientId` en ráfaga con ritmo humano.
 * Nunca lanza por un fallo de envío: aborta la ráfaga y devuelve entrega parcial con `truncated: true`.
 */
export async function sendInstagramBurst(
  provider: BurstMessageProvider,
  recipientId: string,
  chunks: string[],
  options: BurstSendOptions
): Promise<BurstSendResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const prefix = options.logPrefix;
  const total = chunks.length;

  const elapsedMs = now() - options.turnStartedAt;
  let delayBudgetMs = Math.max(0, Math.min(BURST_DELAY_BUDGET_MS, TURN_TIME_BUDGET_MS - elapsedMs));
  let sent = 0;

  for (let i = 0; i < chunks.length; i += 1) {
    // Guard DURO de tiempo: si el turno se acerca al techo de 60s de Vercel, no enviar más chunks (mejor
    // entrega parcial que dejar que Vercel mate la lambda a mitad de envío).
    if (now() - options.turnStartedAt > HARD_TURN_DEADLINE_MS) {
      if (prefix) {
        console.warn(`${prefix} presupuesto de tiempo casi agotado: se corta la rafaga`, { enviados: i, total });
      }
      return { sent, total, truncated: true };
    }
    // Ritmo natural: unos segundos entre mensajes (SOLO entre mensajes, no antes del primero). Se reparte un
    // presupuesto total; si se agota, los últimos salen seguidos en vez de tumbar la función o perderse.
    if (i > 0 && delayBudgetMs > 0) {
      const wait = Math.min(naturalSendDelayMs(chunks[i]), delayBudgetMs);
      delayBudgetMs -= wait;
      await sleep(wait);
    }
    const sendStart = now();
    let ok = await provider.sendTextMessage(recipientId, chunks[i]);
    // Solo se reintenta si el fallo fue RÁPIDO (<3s): un timeout (~3.5s) pudo haberse entregado igual en Meta
    // y reintentar duplicaría el mensaje. Y solo si queda margen REAL bajo el techo, descontando el backoff +
    // el timeout del propio reintento.
    const failedFast = now() - sendStart < 3000;
    const retryDeadlineMs = HARD_TURN_DEADLINE_MS - BURST_RETRY_BACKOFF_MS - 3500;
    if (!ok && failedFast && now() - options.turnStartedAt < retryDeadlineMs) {
      await sleep(BURST_RETRY_BACKOFF_MS);
      ok = await provider.sendTextMessage(recipientId, chunks[i]);
      if (prefix) console.log(`${prefix} reintento de envio`, { sent: ok, parte: `${i + 1}/${total}` });
    }
    if (prefix) console.log(`${prefix} envio a Instagram`, { sent: ok, parte: `${i + 1}/${total}` });
    if (!ok) {
      if (prefix) {
        console.warn(`${prefix} entrega PARCIAL: chunk fallido tras reintento, se aborta el resto`, {
          enviados: i,
          total
        });
      }
      return { sent, total, truncated: true };
    }
    sent += 1;
  }
  return { sent, total, truncated: false };
}
