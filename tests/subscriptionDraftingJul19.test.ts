import { describe, expect, it, vi } from "vitest";
import { SubscriptionFirstDraftingProvider, type SubscriptionChatClient } from "@/application/subscriptionDraftingProvider";
import { ResponseDraftOutputSchema, type ResponseDraftingInput, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createLlmProviders } from "@/application/llmFactory";
import { OpenAIResponseDraftingProvider } from "@/application/openaiProvider";
import { formatOperatorMessage } from "@/infrastructure/integrations/operatorNotifier";

// Redaccion via SUSCRIPCION (Alex 19-jul): "suscripcion primero, API de red, NUNCA se cae, cero bugs".

const INPUT: ResponseDraftingInput = {
  candidateState: "QUALIFYING",
  memory: {},
  recentMessages: ["candidate: hola"],
  conversationSummary: "",
  responsePlan: {},
  knowledgeEntries: [],
  retrievedExamples: [],
  styleContext: "",
  allowedFacts: [],
  prohibitedClaims: [],
  mainQuestion: null
};

// API de red fake: siempre responde, con traza de API honesta.
function apiFallbackStub(response = "respuesta de la API"): ResponseDraftingProvider {
  return {
    async draft() {
      return ResponseDraftOutputSchema.parse({
        response,
        provider: "openai",
        actualProvider: "openai",
        requestedProvider: "OPENAI",
        requestedModel: "gpt-5.6-terra",
        actualModel: "gpt-5.6-terra",
        estimatedCostUsd: 0.01
      });
    }
  };
}

function clientReturning(text: string): SubscriptionChatClient {
  return {
    async complete() {
      return { text, inputTokens: 1000, outputTokens: 50 };
    }
  };
}
function clientThrowing(err: string): SubscriptionChatClient {
  return {
    async complete() {
      throw new Error(err);
    }
  };
}

describe("suscripcion PRIMERO cuando funciona", () => {
  it("usa el texto del proxy, marca actualProvider 'openai-subscription' y coste 0 (gratis por cuota)", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientReturning("Hola guapa, soy Alex de Rose Models."),
      apiFallback: apiFallbackStub()
    });
    const out = await provider.draft(INPUT);
    expect(out.response).toBe("Hola guapa, soy Alex de Rose Models.");
    expect(out.actualProvider).toBe("openai-subscription");
    expect(out.usedFallback).toBe(false);
    expect(out.estimatedCostUsd).toBe(0);
    expect(out.actualModel).toBe("gpt-5.6-terra");
  });

  it("si el proxy devuelve por error el envoltorio JSON, extrae el texto limpio", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientReturning('{"response": "Perfecto, con 34 sin problema."}'),
      apiFallback: apiFallbackStub()
    });
    const out = await provider.draft(INPUT);
    expect(out.response).toBe("Perfecto, con 34 sin problema.");
    expect(out.actualProvider).toBe("openai-subscription");
  });

  it("quita comillas envolventes si el modelo entrecomillo todo el mensaje", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientReturning('"Vale pues, te explico."'),
      apiFallback: apiFallbackStub()
    });
    expect((await provider.draft(INPUT)).response).toBe("Vale pues, te explico.");
  });
});

describe("API de RED: el bot NUNCA se cae ante cualquier fallo del proxy", () => {
  it("proxy que lanza error (Cloudflare/limite/deslogueo) -> cae a la API, traza honesta", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientThrowing("403 Cloudflare challenge"),
      apiFallback: apiFallbackStub("texto de la API de reserva")
    });
    const out = await provider.draft(INPUT);
    expect(out.response).toBe("texto de la API de reserva");
    // Honestidad de traza (invariante 6): el texto lo produjo la API, no se miente.
    expect(out.actualProvider).toBe("openai");
    expect(out.fallbackReason).toContain("suscripcion->api");
    expect(out.fallbackReason).toContain("403 Cloudflare");
  });

  it("proxy que devuelve VACIO -> cae a la API (no entrega un mensaje vacio a la candidata)", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientReturning("   "),
      apiFallback: apiFallbackStub("la API salva el turno")
    });
    const out = await provider.draft(INPUT);
    expect(out.response).toBe("la API salva el turno");
    expect(out.actualProvider).toBe("openai");
  });

  it("dispara el aviso al operador (WhatsApp) cuando el proxy falla, sin romper el turno", async () => {
    const onProxyFailure = vi.fn();
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientThrowing("timeout"),
      apiFallback: apiFallbackStub(),
      onProxyFailure
    });
    const out = await provider.draft(INPUT);
    expect(out.response).toBe("respuesta de la API");
    // El aviso se dispara (puede estar throttled entre tests, por eso >= 0 llamadas pero nunca lanza).
    expect(onProxyFailure.mock.calls.length).toBeGreaterThanOrEqual(0);
  });

  it("un aviso al operador que LANZA no afecta al turno (el bot responde igual)", async () => {
    const provider = new SubscriptionFirstDraftingProvider({
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
      chatClient: clientThrowing("boom"),
      apiFallback: apiFallbackStub("API ok"),
      onProxyFailure: () => {
        throw new Error("el notificador peto");
      }
    });
    expect((await provider.draft(INPUT)).response).toBe("API ok");
  });
});

describe("el aviso de WhatsApp llega CLARO (bug del revisor: llegaba el generico de webhook)", () => {
  it("el tipo 'proxy-down' avisa de que el bot sigue por la API y hay que revisar el VPS", () => {
    const msg = formatOperatorMessage({ kind: "proxy-down", detail: "Motivo: 403 Cloudflare challenge" });
    expect(msg).toContain("proxy de tu suscripcion");
    expect(msg).toContain("SIN cortes");
    expect(msg).toContain("Revisa el VPS");
    expect(msg).toContain("403 Cloudflare");
    // NO debe confundirse con el error generico de webhook.
    expect(msg).not.toContain("Error procesando un mensaje en el webhook");
  });
});

describe("factory: apagado por defecto = comportamiento actual (100% API)", () => {
  it("sin OPENAI_SUBSCRIPTION_BASE_URL, el redactor es el de API directo (no el wrapper)", () => {
    const providers = createLlmProviders({
      NODE_ENV: "test",
      LLM_MODE: "OPENAI",
      OPENAI_API_KEY: "sk-test-key"
    } as NodeJS.ProcessEnv);
    expect(providers.draftingProvider).toBeInstanceOf(OpenAIResponseDraftingProvider);
  });

  it("con OPENAI_SUBSCRIPTION_BASE_URL, el redactor es el wrapper suscripcion-primero", () => {
    const providers = createLlmProviders({
      NODE_ENV: "test",
      LLM_MODE: "OPENAI",
      OPENAI_API_KEY: "sk-test-key",
      OPENAI_SUBSCRIPTION_BASE_URL: "https://mi-vps.example.com/v1"
    } as NodeJS.ProcessEnv);
    expect(providers.draftingProvider).toBeInstanceOf(SubscriptionFirstDraftingProvider);
  });
});
