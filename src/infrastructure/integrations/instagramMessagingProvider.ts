import type { InstagramConfig } from "@/application/instagramConfig";
import type { InstagramMessagingProvider } from "./futureProviders";

/**
 * Envío real de DMs por la Graph API de Instagram (Messenger Platform). El destinatario se identifica
 * por su IGSID (id con ámbito de la app), que es lo que llega en el webhook y lo que usamos como clave
 * de la conversación; por eso `instagramUsername` aquí ES el IGSID.
 *
 * No lanza si la API falla: registra el error (sin secretos) y devuelve para no tumbar el turno; el
 * motor ya persistió estado y la traza marca el fallo. Nunca loguea el access token ni el cuerpo.
 */
export class GraphApiInstagramMessagingProvider implements InstagramMessagingProvider {
  constructor(
    private readonly config: InstagramConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async sendMessage(input: { instagramUsername: string; message: string }): Promise<void> {
    await this.sendTextMessage(input.instagramUsername, input.message);
  }

  /**
   * Envía un texto al IGSID indicado. Devuelve true si la API aceptó el envío.
   *
   * `options.humanAgentTag`: la mensajería estándar (`messaging_type: "RESPONSE"`) solo se puede usar
   * DENTRO de las 24h del último mensaje de la candidata. Pasada esa ventana, Meta exige una etiqueta;
   * para el re-enganche usamos `HUMAN_AGENT` (válida hasta 7 días). Por defecto (sin options o false) el
   * comportamiento es el de siempre (RESPONSE), para no tocar las llamadas existentes del webhook.
   */
  async sendTextMessage(recipientId: string, text: string, options?: { humanAgentTag?: boolean }): Promise<boolean> {
    if (!this.config.isConfigured) {
      console.warn("[instagram] envío omitido: integración no configurada");
      return false;
    }
    const url = `${this.config.graphApiBaseUrl}/${this.config.graphApiVersion}/me/messages`;
    const body = options?.humanAgentTag
      ? { recipient: { id: recipientId }, message: { text }, messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" }
      : { recipient: { id: recipientId }, message: { text }, messaging_type: "RESPONSE" };
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`
        },
        body: JSON.stringify(body),
        // Timeout duro: si Instagram se cuelga, no agotar el techo de ~10s de Vercel a mitad de rafaga.
        signal: AbortSignal.timeout(3500)
      });
      if (!response.ok) {
        // Solo el status y un id de error si lo hay; nunca el token ni el cuerpo completo.
        console.warn("[instagram] envío rechazado", { status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      console.warn("[instagram] error de red al enviar", { error: error instanceof Error ? error.name : "unknown" });
      return false;
    }
  }
}
