import { describe, expect, it, vi } from "vitest";
import { extractIsPrivate, fetchInstagramIsPrivate } from "@/infrastructure/integrations/instagramPrivacyProvider";

describe("instagramPrivacyProvider", () => {
  it("no consulta si falta la clave o el usuario (no-op silencioso)", async () => {
    const fetchMock = vi.fn();
    expect(await fetchInstagramIsPrivate("ana_real", {}, fetchMock as unknown as typeof fetch)).toBeNull();
    expect(await fetchInstagramIsPrivate(null, { HIKERAPI_KEY: "k" }, fetchMock as unknown as typeof fetch)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("consulta con la access key en cabecera y devuelve is_private", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { is_private: true } }) } as Response);
    const result = await fetchInstagramIsPrivate("@ana_real", { HIKERAPI_KEY: "secret" }, fetchMock as unknown as typeof fetch);
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("username=ana_real");
    expect((init as RequestInit).headers).toMatchObject({ "x-access-key": "secret" });
  });

  it("devuelve null si el proveedor falla o la red cae (no lanza)", async () => {
    const rejecting = vi.fn().mockResolvedValue({ ok: false, status: 429 } as Response);
    expect(await fetchInstagramIsPrivate("ana", { HIKERAPI_KEY: "k" }, rejecting as unknown as typeof fetch)).toBeNull();
    const failing = (() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    await expect(fetchInstagramIsPrivate("ana", { HIKERAPI_KEY: "k" }, failing)).resolves.toBeNull();
  });

  it("extractIsPrivate lee is_private en raiz, .user o .data; null si no esta", () => {
    expect(extractIsPrivate({ is_private: false })).toBe(false);
    expect(extractIsPrivate({ user: { is_private: true } })).toBe(true);
    expect(extractIsPrivate({ data: { is_private: false } })).toBe(false);
    expect(extractIsPrivate({ otra: 1 })).toBeNull();
    expect(extractIsPrivate(null)).toBeNull();
  });
});
