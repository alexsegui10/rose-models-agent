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

  /** Envía un texto al IGSID indicado. Devuelve true si la API aceptó el envío. */
  async sendTextMessage(recipientId: string, text: string): Promise<boolean> {
    if (!this.config.isConfigured) {
      console.warn("[instagram] envío omitido: integración no configurada");
      return false;
    }
    const url = `${this.config.graphApiBaseUrl}/${this.config.graphApiVersion}/me/messages`;
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`
        },
        body: JSON.stringify({
          recipient: { id: recipientId },
          message: { text }
        })
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
