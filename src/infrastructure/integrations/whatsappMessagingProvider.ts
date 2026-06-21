import type { WhatsAppConfig } from "@/application/whatsappConfig";

/**
 * Envio de mensajes por la Cloud API de WhatsApp (Meta). El destinatario se identifica por su numero
 * (sin '+'). No lanza si la API falla: registra solo el status (nunca el token ni el cuerpo) y devuelve
 * false, para no tumbar la peticion. La base SIEMPRE es graph.facebook.com (config).
 *
 * NOTA ventana de 24h: enviar texto LIBRE solo es valido dentro de las 24h desde el ultimo mensaje de la
 * candidata; fuera de esa ventana Meta exige una plantilla aprobada (de pago). Esa comprobacion la hace
 * el llamante (la ruta de envio), no este provider.
 */
export class GraphApiWhatsAppMessagingProvider {
  constructor(
    private readonly config: WhatsAppConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  /** Envia un texto al numero indicado (sin '+'). Devuelve true si la API acepto el envio. */
  async sendTextMessage(toPhone: string, text: string): Promise<boolean> {
    if (!this.config.isConfigured) {
      console.warn("[whatsapp] envio omitido: integracion no configurada");
      return false;
    }
    const url = `${this.config.graphApiBaseUrl}/${this.config.graphApiVersion}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toPhone,
      type: "text",
      text: { body: text }
    };
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
      if (!response.ok) {
        console.warn("[whatsapp] envio rechazado", { status: response.status });
        return false;
      }
      return true;
    } catch (error) {
      console.warn("[whatsapp] error de red al enviar", { error: error instanceof Error ? error.name : "unknown" });
      return false;
    }
  }
}
