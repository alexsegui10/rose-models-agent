import { describe, expect, it } from "vitest";
import { getWhatsAppConfig } from "@/application/whatsappConfig";
import { GraphApiWhatsAppMessagingProvider } from "@/infrastructure/integrations/whatsappMessagingProvider";

const configuredEnv = {
  WHATSAPP_VERIFY_TOKEN: "verify",
  WHATSAPP_APP_SECRET: "secret",
  WHATSAPP_ACCESS_TOKEN: "token-permanente",
  WHATSAPP_PHONE_NUMBER_ID: "PHONE_ID"
} as unknown as NodeJS.ProcessEnv;

describe("getWhatsAppConfig", () => {
  it("isConfigured solo cuando estan las 4 vars; base graph.facebook.com por defecto", () => {
    expect(getWhatsAppConfig({} as NodeJS.ProcessEnv).isConfigured).toBe(false);
    const config = getWhatsAppConfig(configuredEnv);
    expect(config.isConfigured).toBe(true);
    expect(config.graphApiBaseUrl).toBe("https://graph.facebook.com");
    expect(config.phoneNumberId).toBe("PHONE_ID");
  });
});

describe("GraphApiWhatsAppMessagingProvider.sendTextMessage", () => {
  it("no envia (y no llama a fetch) si la integracion no esta configurada", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new GraphApiWhatsAppMessagingProvider(getWhatsAppConfig({} as NodeJS.ProcessEnv), fakeFetch);
    expect(await provider.sendTextMessage("34699111222", "hola")).toBe(false);
    expect(called).toBe(false);
  });

  it("postea a {phoneNumberId}/messages con messaging_product whatsapp y Bearer, y devuelve true", async () => {
    let url = "";
    let init: RequestInit | undefined;
    const fakeFetch = (async (u: string, i?: RequestInit) => {
      url = String(u);
      init = i;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new GraphApiWhatsAppMessagingProvider(getWhatsAppConfig(configuredEnv), fakeFetch);

    expect(await provider.sendTextMessage("34699111222", "Hola Laura")).toBe(true);
    expect(url).toBe("https://graph.facebook.com/v21.0/PHONE_ID/messages");
    const body = JSON.parse(String(init?.body));
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("34699111222");
    expect(body.text.body).toBe("Hola Laura");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer token-permanente");
  });

  it("si la API responde !ok devuelve false (no lanza)", async () => {
    const fakeFetch = (async () => new Response("err", { status: 400 })) as unknown as typeof fetch;
    const provider = new GraphApiWhatsAppMessagingProvider(getWhatsAppConfig(configuredEnv), fakeFetch);
    expect(await provider.sendTextMessage("34699111222", "hola")).toBe(false);
  });
});
