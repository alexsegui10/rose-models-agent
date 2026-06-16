import { describe, expect, it, vi } from "vitest";
import { extractIsPrivate, fetchInstagramIsPrivate } from "@/infrastructure/integrations/instagramPrivacyProvider";

describe("instagramPrivacyProvider (Apify)", () => {
  it("no consulta si falta el token o el usuario (no-op silencioso)", async () => {
    const fetchMock = vi.fn();
    expect(await fetchInstagramIsPrivate("ana_real", {}, fetchMock as unknown as typeof fetch)).toBeNull();
    expect(await fetchInstagramIsPrivate(null, { APIFY_TOKEN: "t" }, fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("llama al actor de Apify con el usuario y devuelve el flag private del dataset", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ username: "ana_real", private: true }] } as Response);
    const result = await fetchInstagramIsPrivate("@ana_real", { APIFY_TOKEN: "secret" }, fetchMock as unknown as typeof fetch);
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items");
    expect(String(url)).toContain("token=secret");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ usernames: ["ana_real"] });
  });

  it("devuelve null si el proveedor falla o la red cae (no lanza)", async () => {
    const rejecting = vi.fn().mockResolvedValue({ ok: false, status: 402 } as Response);
    expect(await fetchInstagramIsPrivate("ana", { APIFY_TOKEN: "t" }, rejecting as unknown as typeof fetch)).toBeNull();
    const failing = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    await expect(fetchInstagramIsPrivate("ana", { APIFY_TOKEN: "t" }, failing)).resolves.toBeNull();
  });

  it("extractIsPrivate lee el flag en array (Apify: private) y en objeto (is_private), null si no esta", () => {
    expect(extractIsPrivate([{ private: true }])).toBe(true);
    expect(extractIsPrivate([{ username: "x", private: false }])).toBe(false);
    expect(extractIsPrivate({ is_private: true })).toBe(true);
    expect(extractIsPrivate({ user: { is_private: false } })).toBe(false);
    expect(extractIsPrivate([])).toBeNull();
    expect(extractIsPrivate([{ otra: 1 }])).toBeNull();
    expect(extractIsPrivate(null)).toBeNull();
  });
});
