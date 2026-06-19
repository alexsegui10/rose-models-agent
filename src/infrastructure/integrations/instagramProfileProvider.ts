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
  /** Número de seguidores (si la API lo devuelve). */
  followerCount?: number;
  /** Cuenta verificada (tick azul). */
  isVerified?: boolean;
  /**
   * La candidata SIGUE a la cuenta de negocio. CLAVE: si es true, su perfil es visible para nosotros
   * aunque sea privado -> es el sustituto correcto de "is_private" (que Meta no expone). Campo oficial.
   */
  followsBusiness?: boolean;
  /** La cuenta de negocio sigue a la candidata. */
  businessFollows?: boolean;
}

export interface InstagramProfileResult {
  profile: InstagramProfile | null;
  /** Motivo cuando no se pudo resolver (para diagnóstico; NUNCA incluye el token). */
  reason?: string;
}

// Campos completos (seguidores/verificado/follow) pueden requerir permisos extra o tipo de cuenta. Si la
// API rechaza la consulta con ellos, reintentamos con los básicos para al menos traer foto + @usuario.
const FULL_FIELDS = "name,username,profile_pic,follower_count,is_verified_user,is_user_follow_business,is_business_follow_user";
const MINIMAL_FIELDS = "name,username,profile_pic";

interface QueryResult {
  ok: boolean;
  status: number;
  data?: Record<string, unknown>;
  errorMessage?: string;
}

async function queryProfile(
  igsid: string,
  config: InstagramConfig,
  fields: string,
  fetchImpl: typeof fetch
): Promise<QueryResult> {
  const url = `${config.graphApiBaseUrl}/${encodeURIComponent(igsid)}?fields=${fields}&access_token=${encodeURIComponent(config.accessToken)}`;
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) {
    let errorMessage: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: unknown } };
      if (typeof body.error?.message === "string") {
        errorMessage = body.error.message; // mensaje de Meta (no contiene el token)
      }
    } catch {
      /* sin cuerpo JSON legible */
    }
    return { ok: false, status: response.status, errorMessage };
  }
  const data = (await response.json()) as Record<string, unknown>;
  return { ok: true, status: response.status, data };
}

function mapProfile(data: Record<string, unknown>): InstagramProfile {
  return {
    username: typeof data.username === "string" && data.username.length > 0 ? data.username : undefined,
    name: typeof data.name === "string" && data.name.length > 0 ? data.name : undefined,
    profilePicUrl: typeof data.profile_pic === "string" && data.profile_pic.length > 0 ? data.profile_pic : undefined,
    followerCount: typeof data.follower_count === "number" ? data.follower_count : undefined,
    isVerified: typeof data.is_verified_user === "boolean" ? data.is_verified_user : undefined,
    followsBusiness: typeof data.is_user_follow_business === "boolean" ? data.is_user_follow_business : undefined,
    businessFollows: typeof data.is_business_follow_user === "boolean" ? data.is_business_follow_user : undefined
  };
}

function isEmptyProfile(profile: InstagramProfile): boolean {
  return (
    !profile.username &&
    !profile.name &&
    !profile.profilePicUrl &&
    profile.followsBusiness === undefined &&
    profile.followerCount === undefined
  );
}

/**
 * Igual que fetchInstagramProfile pero devuelve también el MOTIVO cuando no se pudo (para diagnóstico).
 * Intenta los campos completos; si la Graph API los rechaza, reintenta con los básicos (foto + @usuario).
 */
export async function fetchInstagramProfileResult(
  igsid: string,
  config: InstagramConfig,
  fetchImpl: typeof fetch = fetch
): Promise<InstagramProfileResult> {
  if (!config.isConfigured || !config.accessToken) {
    return { profile: null, reason: "INSTAGRAM_ACCESS_TOKEN no configurado" };
  }
  // Los IGSID son cadenas numéricas largas; un usuario de simulador ("ana_test") no es consultable.
  if (!/^\d{5,}$/.test(igsid)) {
    return { profile: null, reason: "el id no es un IGSID numérico (candidata de simulador)" };
  }

  try {
    let result = await queryProfile(igsid, config, FULL_FIELDS, fetchImpl);
    let reason: string | undefined;
    if (!result.ok) {
      reason = `campos completos rechazados (graph ${result.status}${result.errorMessage ? `: ${result.errorMessage}` : ""})`;
      console.warn("[ig-profile] reintentando con campos básicos", { status: result.status });
      result = await queryProfile(igsid, config, MINIMAL_FIELDS, fetchImpl);
      if (!result.ok) {
        return {
          profile: null,
          reason: `graph ${result.status}${result.errorMessage ? `: ${result.errorMessage}` : " (rechazada)"}`
        };
      }
    }
    const profile = mapProfile(result.data ?? {});
    if (isEmptyProfile(profile)) {
      return { profile: null, reason: "la API respondió sin datos de perfil" };
    }
    return { profile, reason };
  } catch (error) {
    return { profile: null, reason: `error de red (${error instanceof Error ? error.name : "desconocido"})` };
  }
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
  return (await fetchInstagramProfileResult(igsid, config, fetchImpl)).profile;
}

/** Enlace público al perfil de Instagram (permanente) a partir del @usuario. */
export function instagramProfileUrl(username: string | undefined): string | null {
  if (!username) return null;
  const handle = username.replace(/^@/, "").trim();
  return handle ? `https://instagram.com/${handle}` : null;
}
