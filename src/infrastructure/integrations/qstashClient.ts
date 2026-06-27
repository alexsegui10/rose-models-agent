import type { QStashConfig } from "@/application/qstashConfig";

/**
 * Programa (publica en QStash) una "llamada de vuelta" DIFERIDA a nuestro endpoint de flush. QStash la
 * entregara dentro de `delaySeconds` (asi Vercel no tiene que esperar; las funciones mueren a los ~10s).
 *
 * Auth del callback: en vez de verificar la firma JWT de QStash (compleja), le pedimos a QStash que
 * REENVIE un bearer nuestro con `Upstash-Forward-Authorization` -> el endpoint de flush lo recibe como
 * `Authorization: Bearer <secret>` y lo valida con `bearerMatches` (mismo patron que el cron). Solo
 * nosotros conocemos el secreto, asi que nadie mas puede disparar un flush. No lanza: devuelve false si falla.
 */
export async function scheduleInboundFlush(args: {
  config: QStashConfig;
  /** URL absoluta de nuestro endpoint de flush (p. ej. https://dominio/api/instagram/flush). */
  flushUrl: string;
  /** Secreto bearer que QStash reenviara al flush para autenticarlo (reutilizamos CRON_SECRET). */
  flushSecret: string;
  senderId: string;
  delaySeconds: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { config, flushUrl, flushSecret, senderId, delaySeconds } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!config.token || !flushSecret) return false;

  const base = config.url.replace(/\/+$/, "");
  // QStash v2 espera la URL destino LITERAL en el path (no URL-encoded), igual que su SDK.
  const url = `${base}/v2/publish/${flushUrl}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Upstash-Delay": `${Math.max(1, Math.round(delaySeconds))}s`,
        // QStash entrega este header al destino como `Authorization` (quita el prefijo Upstash-Forward-).
        "Upstash-Forward-Authorization": `Bearer ${flushSecret}`
      },
      body: JSON.stringify({ senderId }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      console.warn("[qstash] publish rechazado", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[qstash] error al publicar", { error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

/**
 * Publica (SIN retraso) una llamada a nuestro endpoint de deteccion de privacidad, para que corra en una
 * invocacion APARTE con su propio presupuesto de tiempo: asi el saludo del opener sale rapido y la deteccion
 * (Apify, varios segundos) no bloquea la entrega. Mismo patron de auth que el flush (CRON_SECRET reenviado).
 * Best-effort: devuelve false si falla o no esta configurado, nunca lanza.
 */
export async function schedulePrivacyDetection(args: {
  config: QStashConfig;
  /** URL absoluta del endpoint de deteccion (p. ej. https://dominio/api/instagram/detect-privacy). */
  detectUrl: string;
  /** Secreto bearer reenviado al endpoint para autenticarlo (reutilizamos CRON_SECRET). */
  secret: string;
  senderId: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { config, detectUrl, secret, senderId } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!config.token || !secret) return false;

  const base = config.url.replace(/\/+$/, "");
  const url = `${base}/v2/publish/${detectUrl}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Upstash-Forward-Authorization": `Bearer ${secret}`,
        // Dedup: si QStash reintenta o se publica dos veces para el mismo IGSID, NO se avisa a Alex dos
        // veces (la deteccion + aviso son best-effort, una sola vez por candidata basta).
        "Upstash-Deduplication-Id": `detect-privacy-${senderId}`
      },
      body: JSON.stringify({ senderId }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      console.warn("[qstash] publish (deteccion) rechazado", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[qstash] error al publicar (deteccion)", { error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}

/**
 * AUTO-MARCADOR: programa con QStash que a la HORA AGENDADA (dentro de `delaySeconds`) se dispare la llamada
 * saliente sola, llamando a nuestro endpoint /api/call/dispatch. Asi el bot llama solo, sin que Alex pulse el
 * boton. Mismo patron de auth que el flush (reenvia el bearer CRON_SECRET). La Deduplication-Id por
 * (candidata, hora) evita que re-programar el mismo slot (p. ej. si ella escribe otra vez) dispare DOS
 * llamadas. Ademas `Upstash-Retries: 0` -> entrega AT-MOST-ONCE: si la entrega fallara, QStash NO reintenta,
 * asi NUNCA se llama dos veces a una persona por una re-entrega (mejor perder un disparo —el reintento por
 * no-answer o el boton manual lo cubren— que llamar dos veces). Best-effort: devuelve false si falla, no lanza.
 */
export async function scheduleCallDispatch(args: {
  config: QStashConfig;
  /** URL absoluta de nuestro endpoint de disparo (p. ej. https://dominio/api/call/dispatch). */
  dispatchUrl: string;
  /** Secreto bearer que QStash reenviara al endpoint para autenticarlo (reutilizamos CRON_SECRET). */
  secret: string;
  candidateId: string;
  /** La hora agendada exacta (ms epoch); va en el body para que el endpoint detecte reagendados. */
  scheduledForMs: number;
  delaySeconds: number;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const { config, dispatchUrl, secret, candidateId, scheduledForMs, delaySeconds } = args;
  const fetchImpl = args.fetchImpl ?? fetch;
  if (!config.token || !secret) return false;

  const base = config.url.replace(/\/+$/, "");
  const url = `${base}/v2/publish/${dispatchUrl}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "Upstash-Delay": `${Math.max(1, Math.round(delaySeconds))}s`,
        "Upstash-Forward-Authorization": `Bearer ${secret}`,
        "Upstash-Deduplication-Id": `call-dispatch-${candidateId}-${scheduledForMs}`,
        // AT-MOST-ONCE: no reintentar la entrega -> nunca doble-llamada a una persona por re-entrega de QStash.
        "Upstash-Retries": "0"
      },
      body: JSON.stringify({ candidateId, scheduledForMs }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) {
      console.warn("[qstash] publish (call-dispatch) rechazado", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[qstash] error al publicar (call-dispatch)", { error: error instanceof Error ? error.name : "unknown" });
    return false;
  }
}
