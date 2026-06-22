import { getInstagramConfig } from "@/application/instagramConfig";
import { getWhatsAppConfig } from "@/application/whatsappConfig";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { GraphApiWhatsAppMessagingProvider } from "@/infrastructure/integrations/whatsappMessagingProvider";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import type { Candidate } from "@/domain/candidate";

export type CandidateChannel = "instagram" | "whatsapp" | "none";

/**
 * Canal real de la candidata segun su clave de conversacion: "wa:<digitos>" = WhatsApp; IGSID numerico =
 * Instagram; cualquier otra cosa (usernames del simulador/tests) = ninguno (no se envia a fuera). Puro.
 */
export function candidateChannel(instagramUsername: string): CandidateChannel {
  if (instagramUsername.startsWith("wa:")) return "whatsapp";
  if (/^\d{5,}$/.test(instagramUsername)) return "instagram";
  return "none";
}

const PAUSE_BETWEEN_CHUNKS_MS = 1000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Entrega a la candidata, por SU canal (Instagram o WhatsApp), un mensaje PROACTIVO del bot generado por una
 * accion del CRM (aprobacion de perfil/movil, etc.). NO guarda el mensaje (ya lo persistio el motor): SOLO
 * lo ENVIA, en rafaga (un mensaje por parrafo). No-op (delivered=false) si el canal no esta configurado o la
 * candidata es del simulador (no real). No lanza: los providers se tragan sus errores y devuelven false.
 *
 * Esto cierra el hueco por el que las decisiones del CRM (human-review, advance-stage) guardaban el mensaje
 * del bot pero NUNCA lo enviaban a Instagram (a diferencia del webhook y de las respuestas manuales de Alex).
 */
export async function deliverProactiveMessage(
  candidate: Pick<Candidate, "instagramUsername" | "phone">,
  message: string
): Promise<{ delivered: boolean; channel: CandidateChannel }> {
  const text = message.trim();
  const channel = candidateChannel(candidate.instagramUsername);
  if (!text || channel === "none") {
    return { delivered: false, channel };
  }
  const chunks = splitIntoMessageBurst(text);

  if (channel === "whatsapp") {
    const config = getWhatsAppConfig();
    const toPhone = candidate.phone?.replace(/\D/g, "") || candidate.instagramUsername.replace(/^wa:/, "");
    if (!config.isConfigured || !toPhone) return { delivered: false, channel };
    const provider = new GraphApiWhatsAppMessagingProvider(config);
    return { delivered: await sendBurst((chunk) => provider.sendTextMessage(toPhone, chunk), chunks), channel };
  }

  // Instagram (IGSID numerico).
  const config = getInstagramConfig();
  if (!config.isConfigured) return { delivered: false, channel };
  const provider = new GraphApiInstagramMessagingProvider(config);
  return { delivered: await sendBurst((chunk) => provider.sendTextMessage(candidate.instagramUsername, chunk), chunks), channel };
}

/** Envia los chunks en rafaga (pausa humana entre ellos). Si uno falla, aborta el resto (no enviar fuera de orden). */
async function sendBurst(send: (chunk: string) => Promise<boolean>, chunks: string[]): Promise<boolean> {
  let anySent = false;
  for (let i = 0; i < chunks.length; i += 1) {
    if (i > 0) await sleep(PAUSE_BETWEEN_CHUNKS_MS);
    const sent = await send(chunks[i]);
    if (!sent) break;
    anySent = true;
  }
  return anySent;
}
