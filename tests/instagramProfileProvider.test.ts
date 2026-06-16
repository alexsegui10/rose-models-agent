import { describe, expect, it, vi } from "vitest";
import type { InstagramConfig } from "@/application/instagramConfig";
import { fetchInstagramProfile, instagramProfileUrl } from "@/infrastructure/integrations/instagramProfileProvider";

function config(overrides: Partial<InstagramConfig> = {}): InstagramConfig {
  return {
    isConfigured: true,
    verifyToken: "",
    appSecret: "secret",
    appSecretCandidates: ["secret"],
    accessToken: "token",
    graphApiBaseUrl: "https://graph.instagram.com",
    graphApiVersion: "v21.0",
    ...overrides
  };
}

const IGSID = "17841400000000000";

describe("fetchInstagramProfile", () => {
  it("devuelve null si la integracion no esta configurada", async () => {
    const fetchMock = vi.fn();
    expect(await fetchInstagramProfile(IGSID, config({ isConfigured: false }), fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no consulta si el id no parece un IGSID (usuario de simulador)", async () => {
    const fetchMock = vi.fn();
    expect(await fetchInstagramProfile("ana_test", config(), fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mapea name/username/profile_pic + relacion de follow (sustituto de is_private)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "Ana",
        username: "ana_real",
        profile_pic: "https://cdn/x.jpg",
        follower_count: 1234,
        is_verified_user: false,
        is_user_follow_business: true,
        is_business_follow_user: false
      })
    } as Response);
    const profile = await fetchInstagramProfile(IGSID, config(), fetchMock as unknown as typeof fetch);
    expect(profile).toEqual({
      username: "ana_real",
      name: "Ana",
      profilePicUrl: "https://cdn/x.jpg",
      followerCount: 1234,
      isVerified: false,
      followsBusiness: true,
      businessFollows: false
    });
    // La URL pide los campos de follow y nunca se loguea (solo se pasa a fetch).
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("is_user_follow_business");
    expect(calledUrl).toContain("profile_pic");
    expect(calledUrl).toContain(IGSID);
  });

  it("devuelve null si la API rechaza o si falla la red (no lanza)", async () => {
    const rejecting = vi.fn().mockResolvedValue({ ok: false, status: 400 } as Response);
    expect(await fetchInstagramProfile(IGSID, config(), rejecting as unknown as typeof fetch)).toBeNull();

    const failing = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    await expect(fetchInstagramProfile(IGSID, config(), failing)).resolves.toBeNull();
  });

  it("instagramProfileUrl construye el enlace permanente", () => {
    expect(instagramProfileUrl("ana_real")).toBe("https://instagram.com/ana_real");
    expect(instagramProfileUrl("@ana_real")).toBe("https://instagram.com/ana_real");
    expect(instagramProfileUrl(undefined)).toBeNull();
  });
});
