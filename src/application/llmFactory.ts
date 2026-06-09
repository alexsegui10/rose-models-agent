import { DeterministicUnderstandingProvider } from "./dataExtractor";
import { getLlmRuntimeConfig, type LlmRuntimeConfig } from "./llmConfig";
import type { ConversationUnderstandingProvider, ResponseDraftingProvider } from "./llmProvider";
import { OpenAIConversationUnderstandingProvider, OpenAIResponseDraftingProvider } from "./openaiProvider";

export interface LlmProviders {
  config: LlmRuntimeConfig;
  understandingProvider: ConversationUnderstandingProvider;
  draftingProvider?: ResponseDraftingProvider;
}

export function createLlmProviders(env: NodeJS.ProcessEnv = process.env): LlmProviders {
  const config = getLlmRuntimeConfig(env);
  const deterministic = new DeterministicUnderstandingProvider();

  if (config.llmMode !== "OPENAI" || !config.openaiApiKey) {
    return {
      config,
      understandingProvider: deterministic
    };
  }

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
    draftingProvider: new OpenAIResponseDraftingProvider({
      apiKey: config.openaiApiKey,
      understandingModel: config.understandingModel,
      writingModel: config.writingModel,
      timeoutMs: config.timeoutMs,
      maxRetries: config.maxRetries
    })
  };
}
