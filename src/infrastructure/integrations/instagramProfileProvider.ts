import type { InstagramConfig } from "@/application/instagramConfig";

/**
 * Perfil público de una candidata de Instagram, resuelto a partir de su IGSID (el id con ámbito de app
 * que llega en el webhook; Instagram NO da el @usuario ni la foto en el evento). Se pide a la Graph API
 * con el token de la app. Campos opcionales: la API puede no devolver todos según permisos/privacidad.
 */
export interface InstagramProfile {
  /** @usuario público, p. ej. "rosemodels_ofm" (para enlazar a instagram.com/usuario). */
  username?: string;
  /** Nombre mostrado. */
  name?: string;
  /** URL pública (CDN de Meta) de la foto de perfil. Puede caducar con el tiempo. */
  profilePicUrl?: string;
}

/**
 * Pide el perfil (name, username, profile_pic) a la Graph API a partir del IGSID. Best-effort: si la
 * integración no está configurada, el id no es un IGSID válido o la API falla, devuelve null sin lanzar
 * (un fallo de enriquecimiento jamás debe romper el CRM). Nunca loguea el token ni la URL con el token.
 */
export async function fetchInstagramProfile(
  igsid: string,
  config: InstagramConfig,
  fetchImpl: typeof fetch = fetch
): Promise<InstagramProfile | null> {
  if (!config.isConfigured || !config.accessToken) return null;
  // Los IGSID son cadenas numéricas largas; un usuario de simulador ("ana_test") no es consultable.
  if (!/^\d{5,}$/.test(igsid)) return null;

  const url = `${config.graphApiBaseUrl}/${encodeURIComponent(igsid)}?fields=name,username,profile_pic&access_token=${encodeURIComponent(config.accessToken)}`;
  try {
    const response = await fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      console.warn("[ig-profile] la Graph API rechazó la consulta de perfil", { status: response.status });
      return null;
    }
    const data = (await response.json()) as { name?: unknown; username?: unknown; profile_pic?: unknown };
    const profile: InstagramProfile = {
      username: typeof data.username === "string" && data.username.length > 0 ? data.username : undefined,
      name: typeof data.name === "string" && data.name.length > 0 ? data.name : undefined,
      profilePicUrl: typeof data.profile_pic === "string" && data.profile_pic.length > 0 ? data.profile_pic : undefined
    };
    if (!profile.username && !profile.name && !profile.profilePicUrl) return null;
    return profile;
  } catch (error) {
    console.warn("[ig-profile] error de red al consultar el perfil", {
      error: error instanceof Error ? error.name : "unknown"
    });
    return null;
  }
}

/** Enlace público al perfil de Instagram (permanente) a partir del @usuario. */
export function instagramProfileUrl(username: string | undefined): string | null {
  if (!username) return null;
  const handle = username.replace(/^@/, "").trim();
  return handle ? `https://instagram.com/${handle}` : null;
}
