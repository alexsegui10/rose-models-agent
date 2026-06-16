import { NextResponse } from "next/server";
import { getInstagramConfig } from "@/application/instagramConfig";
import {
  fetchInstagramProfile,
  instagramProfileUrl,
  type InstagramProfile
} from "@/infrastructure/integrations/instagramProfileProvider";

export const runtime = "nodejs";

// Caché en memoria (por lambda) para no machacar la Graph API: el perfil cambia poco. TTL corto para que
// la foto (URL de CDN que caduca) no se quede obsoleta mucho tiempo.
const PROFILE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { profile: InstagramProfile | null; expiresAt: number }>();

/**
 * GET /api/instagram/profile?id=<IGSID> — devuelve { ok, username, name, profilePicUrl, profileUrl } del
 * perfil público de la candidata para enriquecer el CRM (foto + enlace a su cuenta). Si no está
 * configurado Instagram o el perfil no se puede resolver, responde { ok: false } (el CRM hace fallback).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ ok: false, error: "missing-id" }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(id);
  if (cached && cached.expiresAt > now) {
    return profileResponse(cached.profile);
  }

  const profile = await fetchInstagramProfile(id, getInstagramConfig());
  cache.set(id, { profile, expiresAt: now + PROFILE_TTL_MS });
  return profileResponse(profile);
}

function profileResponse(profile: InstagramProfile | null): NextResponse {
  if (!profile) {
    return NextResponse.json({ ok: false });
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
    businessFollows: profile.businessFollows ?? null
  });
}
