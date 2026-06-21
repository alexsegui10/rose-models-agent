/**
 * Configuracion de la integracion con WhatsApp (Cloud API de Meta). Los secretos viven en `.env.local`
 * (gitignorado); aqui solo se leen. Si falta algo, la integracion queda DESACTIVADA (isConfigured=false)
 * y el webhook responde sin procesar — nunca se cae el proceso por falta de env (mismo patron que Instagram).
 *
 * IMPORTANTE: la WhatsApp Cloud API SIEMPRE usa `graph.facebook.com` (NO `graph.instagram.com`). El numero
 * es el de la agencia (el mismo que usa ElevenLabs para las llamadas); aqui se gestionan los MENSAJES.
 */
export interface WhatsAppConfig {
  isConfigured: boolean;
  /** Token que elegimos nosotros para el handshake del webhook (GET hub.verify_token). */
  verifyToken: string;
  /** App secret de la app de Meta: verifica la firma X-Hub-Signature-256 de cada POST. */
  appSecret: string;
  /** Secretos candidatos para verificar la firma (normalmente uno). */
  appSecretCandidates: string[];
  /** Token PERMANENTE (System User) con permiso de mensajeria para llamar a la Graph API. */
  accessToken: string;
  /** Id del numero de telefono de WhatsApp (el que sale en el panel; distinto del WABA id). */
  phoneNumberId: string;
  /** Base de la Graph API. SIEMPRE graph.facebook.com para la Cloud API. */
  graphApiBaseUrl: string;
  /** Version de la Graph API. */
  graphApiVersion: string;
}

export function getWhatsAppConfig(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "";
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const graphApiBaseUrl = env.WHATSAPP_GRAPH_BASE_URL?.trim() || "https://graph.facebook.com";
  const graphApiVersion = env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0";

  // El App Secret es del MISMO Meta app que Instagram (la app "Rose Models" tiene los dos casos de uso:
  // Instagram + WhatsApp), asi que la firma del webhook se valida con el mismo secreto. Si no se pone
  // WHATSAPP_APP_SECRET, se reutiliza el de Instagram (INSTAGRAM_APP_SECRET / _ALT). verifyWebhookSignature
  // prueba todos los candidatos y usa el que cuadre, asi que incluirlos todos es robusto.
  const appSecretCandidates = [
    ...new Set(
      [env.WHATSAPP_APP_SECRET?.trim(), env.INSTAGRAM_APP_SECRET?.trim(), env.INSTAGRAM_APP_SECRET_ALT?.trim()].filter(
        (value): value is string => Boolean(value)
      )
    )
  ];
  const appSecret = appSecretCandidates[0] ?? "";

  return {
    isConfigured: Boolean(verifyToken && appSecret && accessToken && phoneNumberId),
    verifyToken,
    appSecret,
    appSecretCandidates,
    accessToken,
    phoneNumberId,
    graphApiBaseUrl,
    graphApiVersion
  };
}
