import { NextResponse } from "next/server";
import { getInstagramConfig } from "@/application/instagramConfig";
import {
  fetchInstagramProfile,
  fetchInstagramProfileResult,
  instagramProfileUrl,
  type InstagramProfile
} from "@/infrastructure/integrations/instagramProfileProvider";
import { fetchInstagramIsPrivate } from "@/infrastructure/integrations/instagramPrivacyProvider";

export const runtime = "nodejs";

// Caché en memoria (por lambda) para no machacar la Graph API ni el proveedor de privacidad (cada consulta
// al proveedor cuesta y tarda): el perfil y la privacidad cambian poco. TTL corto para que la foto (URL de
// CDN que caduca) no se quede obsoleta mucho tiempo.
const PROFILE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { profile: InstagramProfile | null; isPrivate: boolean | null; expiresAt: number }>();

/**
 * GET /api/instagram/profile?id=<IGSID> — enriquece el CRM con el perfil público de la candidata:
 * foto + @usuario + enlace + relación de follow (API oficial), y is_private vía proveedor de terceros
 * (HikerAPI, solo si HIKERAPI_KEY está configurada). Si algo no se puede resolver, devuelve los campos
 * que sí y null en el resto; el CRM hace fallback con elegancia.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const id = params.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing-id" }, { status: 400 });
  }

  // Modo diagnóstico (?debug=1): sin caché, expone el MOTIVO si no se pudo traer el perfil y si hay token.
  // No revela el token (solo si está presente o no). Útil para ver por qué no salen foto/@.
  // Gateado tras una env explicita: sin INSTAGRAM_PROFILE_DEBUG=on, el modo debug NO expone metadatos de
  // configuracion (token presente, baseUrl...) y se cae al flujo normal. Evita filtrar config en prod.
  if (params.get("debug") === "1" && process.env.INSTAGRAM_PROFILE_DEBUG === "on") {
    const config = getInstagramConfig();
    const result = await fetchInstagramProfileResult(id, config);
    return NextResponse.json({
      ok: Boolean(result.profile),
      reason: result.reason ?? null,
      hasAccessToken: Boolean(config.accessToken),
      isConfigured: config.isConfigured,
      graphApiBaseUrl: config.graphApiBaseUrl,
      username: result.profile?.username ?? null,
      hasPhoto: Boolean(result.profile?.profilePicUrl)
    });
  }

  const now = Date.now();
  const cached = cache.get(id);
  if (cached && cached.expiresAt > now) {
    return profileResponse(cached.profile, cached.isPrivate);
  }

  const profile = await fetchInstagramProfile(id, getInstagramConfig());
  // is_private SOLO si el perfil dio @usuario y HikerAPI esta configurado (si no, queda null/desconocido).
  const isPrivate = await fetchInstagramIsPrivate(profile?.username);
  cache.set(id, { profile, isPrivate, expiresAt: now + PROFILE_TTL_MS });
  return profileResponse(profile, isPrivate);
}

function profileResponse(profile: InstagramProfile | null, isPrivate: boolean | null): NextResponse {
  if (!profile) {
    return NextResponse.json({ ok: false, isPrivate });
  }
  return NextResponse.json({
    ok: true,
    username: profile.username ?? null,
    name: profile.name ?? null,
    profilePicUrl: profile.profilePicUrl ?? null,
    profileUrl: instagramProfileUrl(profile.username),
    followerCount: profile.followerCount ?? null,
    isVerified: profile.isVerified ?? null,
    followsBusiness: profile.followsBusiness ?? null,
    businessFollows: profile.businessFollows ?? null,
    isPrivate
  });
}
