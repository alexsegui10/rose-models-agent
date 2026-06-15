/**
 * Configuración de la integración con Instagram (Messenger Platform). Todos los secretos viven en
 * `.env.local` (gitignorado); aquí solo se leen. Si falta algo, la integración queda DESACTIVADA
 * (isConfigured=false) y el webhook responde sin procesar — nunca se cae el proceso por falta de env.
 */
export interface InstagramConfig {
  isConfigured: boolean;
  /** Token que elegimos nosotros para el handshake del webhook (GET hub.verify_token). */
  verifyToken: string;
  /** App secret de la app de Meta: verifica la firma X-Hub-Signature-256 de cada POST. */
  appSecret: string;
  /**
   * Secretos candidatos para verificar la firma, en orden: [primario, ...alternativos]. Permite poner
   * el App Secret de Básica Y el de Instagram a la vez (INSTAGRAM_APP_SECRET_ALT) y que el código elija
   * el que cuadra, en vez de adivinar. En producción normal basta con uno.
   */
  appSecretCandidates: string[];
  /** Token de acceso (Page/Instagram) para llamar a la Graph API al enviar mensajes. */
  accessToken: string;
  /** Base de la Graph API. graph.instagram.com (Instagram login) o graph.facebook.com (Facebook login). */
  graphApiBaseUrl: string;
  /** Versión de la Graph API. */
  graphApiVersion: string;
}

export function getInstagramConfig(env: NodeJS.ProcessEnv = process.env): InstagramConfig {
  const verifyToken = env.INSTAGRAM_VERIFY_TOKEN?.trim() ?? "";
  const appSecret = env.INSTAGRAM_APP_SECRET?.trim() ?? "";
  const appSecretAlt = env.INSTAGRAM_APP_SECRET_ALT?.trim() ?? "";
  const accessToken = env.INSTAGRAM_ACCESS_TOKEN?.trim() ?? "";
  const graphApiBaseUrl = env.INSTAGRAM_GRAPH_BASE_URL?.trim() || "https://graph.instagram.com";
  const graphApiVersion = env.INSTAGRAM_GRAPH_VERSION?.trim() || "v21.0";

  // Sin duplicados ni vacíos; el primario va primero.
  const appSecretCandidates = [...new Set([appSecret, appSecretAlt].filter(Boolean))];

  return {
    isConfigured: Boolean(verifyToken && appSecret && accessToken),
    verifyToken,
    appSecret,
    appSecretCandidates,
    accessToken,
    graphApiBaseUrl,
    graphApiVersion
  };
}
