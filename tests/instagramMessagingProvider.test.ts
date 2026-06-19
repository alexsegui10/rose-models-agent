import { describe, expect, it, vi } from "vitest";
import type { InstagramConfig } from "@/application/instagramConfig";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";

const config: InstagramConfig = {
  isConfigured: true,
  verifyToken: "vt",
  appSecret: "as",
  appSecretCandidates: ["as"],
  accessToken: "token-123",
  graphApiBaseUrl: "https://graph.instagram.com",
  graphApiVersion: "v21.0"
};

function bodyOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe("GraphApiInstagramMessagingProvider.sendTextMessage", () => {
  it("sin options usa messaging_type RESPONSE (como antes, no rompe el webhook)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const provider = new GraphApiInstagramMessagingProvider(config, fetchMock as unknown as typeof fetch);

    const sent = await provider.sendTextMessage("igsid-1", "hola");

    expect(sent).toBe(true);
    const body = bodyOf(fetchMock);
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.tag).toBeUndefined();
    expect(body.recipient).toEqual({ id: "igsid-1" });
    expect(body.message).toEqual({ text: "hola" });
  });

  it("con humanAgentTag=false usa RESPONSE (sin tag)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const provider = new GraphApiInstagramMessagingProvider(config, fetchMock as unknown as typeof fetch);

    await provider.sendTextMessage("igsid-2", "hola", { humanAgentTag: false });

    const body = bodyOf(fetchMock);
    expect(body.messaging_type).toBe("RESPONSE");
    expect(body.tag).toBeUndefined();
  });

  it("con humanAgentTag=true usa MESSAGE_TAG + tag HUMAN_AGENT (fuera de la ventana de 24h)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const provider = new GraphApiInstagramMessagingProvider(config, fetchMock as unknown as typeof fetch);

    await provider.sendTextMessage("igsid-3", "te escribo de nuevo", { humanAgentTag: true });

    const body = bodyOf(fetchMock);
    expect(body.messaging_type).toBe("MESSAGE_TAG");
    expect(body.tag).toBe("HUMAN_AGENT");
    expect(body.recipient).toEqual({ id: "igsid-3" });
    expect(body.message).toEqual({ text: "te escribo de nuevo" });
  });

  it("no envia si la integracion no esta configurada", async () => {
    const fetchMock = vi.fn();
    const provider = new GraphApiInstagramMessagingProvider(
      { ...config, isConfigured: false },
      fetchMock as unknown as typeof fetch
    );

    const sent = await provider.sendTextMessage("igsid-4", "hola", { humanAgentTag: true });

    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
