import { DeterministicUnderstandingProvider } from "./dataExtractor";
import { getLlmRuntimeConfig, type LlmRuntimeConfig } from "./llmConfig";
import type { ConversationUnderstandingProvider, ResponseDraftingProvider } from "./llmProvider";
import { OpenAIConversationUnderstandingProvider, OpenAIResponseDraftingProvider } from "./openaiProvider";
import { createOpenAiCompatibleSubscriptionClient, SubscriptionFirstDraftingProvider } from "./subscriptionDraftingProvider";

export interface LlmProviders {
  config: LlmRuntimeConfig;
  understandingProvider: ConversationUnderstandingProvider;
  draftingProvider?: ResponseDraftingProvider;
}

export function createLlmProviders(
  env: NodeJS.ProcessEnv = process.env,
  // Aviso al operador (WhatsApp) cuando el proxy de la suscripcion falla. Se inyecta desde la composicion
  // (donde vive el notificador CallMeBot) para no importar infraestructura desde application.
  onSubscriptionProxyFailure?: (message: string) => void
): LlmProviders {
  const config = getLlmRuntimeConfig(env);
  const deterministic = new DeterministicUnderstandingProvider();

  if (config.llmMode !== "OPENAI" || !config.openaiApiKey) {
    return {
      config,
      understandingProvider: deterministic
    };
  }

  // Redactor de API (red de seguridad SIEMPRE presente). La COMPRENSION jamas usa la suscripcion.
  const apiDrafting = new OpenAIResponseDraftingProvider({
    apiKey: config.openaiApiKey,
    understandingModel: config.understandingModel,
    writingModel: config.writingModel,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries
  });

  // Redaccion via SUSCRIPCION solo si esta configurada la URL del proxy; si no, se usa la API tal cual (hoy).
  const draftingProvider: ResponseDraftingProvider = config.subscriptionBaseUrl
    ? new SubscriptionFirstDraftingProvider({
        model: config.subscriptionModel ?? config.writingModel,
        timeoutMs: config.timeoutMs,
        chatClient: createOpenAiCompatibleSubscriptionClient({
          baseUrl: config.subscriptionBaseUrl,
          apiKey: config.subscriptionApiKey ?? "sk-proxy-placeholder"
        }),
        apiFallback: apiDrafting,
        onProxyFailure: onSubscriptionProxyFailure
      })
    : apiDrafting;

  return {
    config,
    understandingProvider: new OpenAIConversationUnderstandingProvider({
      apiKey: config.openaiApiKey,
      understandingModel: config.understandingModel,
      writingModel: config.writingModel,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries,
      fallbackUnderstandingProvider: deterministic
    }),
    draftingProvider
  };
}
