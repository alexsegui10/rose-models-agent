import { AutomationModeSchema, type AutomationMode } from "@/domain/automation";

export type LlmMode = "DETERMINISTIC" | "OPENAI";

export interface LlmRuntimeConfig {
  llmMode: LlmMode;
  automationMode: AutomationMode;
  openaiApiKey?: string;
  understandingModel: string;
  writingModel: string;
  reviewModel: string;
  timeoutMs: number;
  maxRetries: number;
}

const defaultUnderstandingModel = "gpt-4.1-mini";
const defaultWritingModel = "gpt-4.1-mini";
const defaultReviewModel = "gpt-4.1-mini";

export function getLlmRuntimeConfig(env: NodeJS.ProcessEnv = process.env): LlmRuntimeConfig {
  const requestedMode = env.LLM_MODE === "OPENAI" ? "OPENAI" : "DETERMINISTIC";
  const openaiApiKey = env.OPENAI_API_KEY?.trim() || undefined;
  const llmMode: LlmMode = requestedMode === "OPENAI" && openaiApiKey ? "OPENAI" : "DETERMINISTIC";
  const automationMode = AutomationModeSchema.catch("HUMAN_APPROVAL").parse(env.AUTOMATION_MODE);

  return {
    llmMode,
    automationMode,
    openaiApiKey,
    understandingModel: env.OPENAI_UNDERSTANDING_MODEL?.trim() || defaultUnderstandingModel,
    writingModel: env.OPENAI_WRITING_MODEL?.trim() || defaultWritingModel,
    reviewModel: env.OPENAI_REVIEW_MODEL?.trim() || defaultReviewModel,
    timeoutMs: positiveNumber(env.OPENAI_TIMEOUT_MS, 12000),
    maxRetries: positiveNumber(env.OPENAI_MAX_RETRIES, 1)
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
