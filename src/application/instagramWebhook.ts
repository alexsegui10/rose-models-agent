import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lógica PURA del webhook de Instagram (Messenger Platform / Instagram Messaging API). Sin I/O: solo
 * verifica firmas, valida el handshake de suscripción y parsea los eventos entrantes a un formato
 * propio. El envío de mensajes y la conexión con el motor viven en infrastructure/app.
 *
 * Meta firma cada POST con `X-Hub-Signature-256: sha256=<hmac-sha256(rawBody, appSecret)>`. NUNCA se
 * procesa un evento sin verificar la firma (cualquiera podría hacer POST al endpoint público).
 */

export interface InstagramInboundMessage {
  /** IGSID: id del usuario con ámbito de la app (NO el @username). Es la clave de la conversación. */
  senderId: string;
  text: string;
  /** mid del mensaje de Instagram: sirve de id externo para idempotencia (no procesar dos veces). */
  messageId?: string;
}

/** Handshake de verificación del webhook (GET): Meta manda hub.mode/hub.verify_token/hub.challenge. */
export function resolveWebhookChallenge(
  params: { mode?: string | null; verifyToken?: string | null; challenge?: string | null },
  expectedVerifyToken: string
): string | null {
  if (!expectedVerifyToken) return null;
  if (params.mode === "subscribe" && params.verifyToken === expectedVerifyToken) {
    return params.challenge ?? "";
  }
  return null;
}

/** Verifica la firma HMAC-SHA256 del cuerpo crudo. Comparación en tiempo constante. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const received = Buffer.from(signatureHeader);
  const computed = Buffer.from(expected);
  return received.length === computed.length && timingSafeEqual(received, computed);
}

/**
 * Parsea el payload del webhook a los mensajes de texto entrantes de candidatas. Ignora: ecos de
 * nuestros propios envíos (is_echo), reacciones/lecturas/adjuntos sin texto, y cualquier evento que no
 * sea un mensaje de texto. Robusto ante formas inesperadas (devuelve [] en vez de lanzar).
 */
export function parseInstagramWebhookEvent(body: unknown): InstagramInboundMessage[] {
  const messages: InstagramInboundMessage[] = [];
  if (!isRecord(body)) return messages;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of events) {
      if (!isRecord(event)) continue;
      const message = isRecord(event.message) ? event.message : null;
      if (!message || message.is_echo === true) continue;
      const text = typeof message.text === "string" ? message.text.trim() : "";
      const sender = isRecord(event.sender) ? event.sender : null;
      const senderId = sender && typeof sender.id === "string" ? sender.id : "";
      if (!text || !senderId) continue;
      messages.push({
        senderId,
        text,
        messageId: typeof message.mid === "string" ? message.mid : undefined
      });
    }
  }
  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
