/**
 * Logica PURA del parseo del webhook de WhatsApp (Cloud API de Meta). Sin I/O: convierte el payload
 * entrante a un formato propio. La verificacion de firma y el handshake son IDENTICOS a Instagram
 * (mismo `X-Hub-Signature-256` HMAC-SHA256), asi que se reutilizan de `instagramWebhook.ts` (utilidades
 * genericas de Meta) en lugar de duplicarlas. El envio y la conexion con el almacen viven en infra/app.
 *
 * Formato de WhatsApp (distinto de Instagram): los mensajes vienen en
 * `entry[].changes[].value.messages[]`, con `from` (numero sin '+'), `id` (wamid), `type`, y `text.body`
 * o `image`/`document`/`audio`/`video` con su `id` de media. `value.statuses[]` son acuses de entrega
 * (se ignoran). `value.metadata.phone_number_id` identifica el numero que recibio el mensaje.
 */

export interface WhatsAppInboundAttachment {
  type: "image" | "document" | "audio" | "video" | "sticker";
  /** Id de media de Meta: se descarga aparte (con token, URL temporal). */
  mediaId: string;
  mimeType?: string;
  filename?: string;
}

export interface WhatsAppInboundMessage {
  /** Numero del remitente (sin '+'); es la clave de la conversacion de WhatsApp. */
  senderId: string;
  text: string;
  /** wamid del mensaje: id externo para idempotencia (no procesar dos veces). */
  messageId?: string;
  /** phone_number_id que recibio el mensaje (para enrutar/filtrar por el numero de la agencia). */
  phoneNumberId?: string;
  /** Adjunto (foto/documento/audio/video), si el mensaje es de media. 1 media = 1 mensaje. */
  attachment?: WhatsAppInboundAttachment;
}

const MEDIA_TYPES = new Set(["image", "document", "audio", "video", "sticker"]);

/**
 * Parsea el payload del webhook a los mensajes entrantes (texto y/o media). Ignora acuses de entrega
 * (`statuses`), ubicaciones/contactos/reacciones y cualquier forma inesperada (devuelve [] en vez de lanzar).
 */
export function parseWhatsAppWebhookEvent(body: unknown): WhatsAppInboundMessage[] {
  const out: WhatsAppInboundMessage[] = [];
  if (!isRecord(body)) return out;
  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    if (!isRecord(entry)) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isRecord(change)) continue;
      const value = isRecord(change.value) ? change.value : null;
      if (!value) continue;
      const metadata = isRecord(value.metadata) ? value.metadata : null;
      const phoneNumberId = metadata && typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : undefined;
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of messages) {
        if (!isRecord(message)) continue;
        const senderId = typeof message.from === "string" ? message.from : "";
        if (!senderId) continue;
        const messageId = typeof message.id === "string" ? message.id : undefined;
        const type = typeof message.type === "string" ? message.type : "";

        let text = "";
        let attachment: WhatsAppInboundAttachment | undefined;

        if (type === "text" && isRecord(message.text) && typeof message.text.body === "string") {
          text = message.text.body.trim();
        } else if (MEDIA_TYPES.has(type) && isRecord(message[type])) {
          const media = message[type] as Record<string, unknown>;
          const mediaId = typeof media.id === "string" ? media.id : "";
          if (mediaId) {
            attachment = {
              type: type as WhatsAppInboundAttachment["type"],
              mediaId,
              mimeType: typeof media.mime_type === "string" ? media.mime_type : undefined,
              filename: typeof media.filename === "string" ? media.filename : undefined
            };
          }
          if (typeof media.caption === "string") text = media.caption.trim();
        }

        // Solo emitimos si hay algo util (texto o adjunto). Ubicaciones/contactos/reacciones se ignoran.
        if (!text && !attachment) continue;
        out.push({ senderId, text, messageId, phoneNumberId, attachment });
      }
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
