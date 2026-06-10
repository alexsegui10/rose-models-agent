import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

function buildEnv(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("getLlmRuntimeConfig", () => {
  it("usa gpt-5.4-mini como default (gpt-4.1-mini esta deslistado por OpenAI)", () => {
    const config = getLlmRuntimeConfig(buildEnv());

    expect(config.understandingModel).toBe("gpt-5.4-mini");
    expect(config.writingModel).toBe("gpt-5.4-mini");
  });

  it("respeta los modelos definidos por entorno", () => {
    const config = getLlmRuntimeConfig(
      buildEnv({
        OPENAI_UNDERSTANDING_MODEL: "gpt-5.4-nano",
        OPENAI_WRITING_MODEL: "gpt-5.4-mini"
      })
    );

    expect(config.understandingModel).toBe("gpt-5.4-nano");
    expect(config.writingModel).toBe("gpt-5.4-mini");
  });

  it("cae a DETERMINISTIC si se pide OPENAI sin clave", () => {
    const config = getLlmRuntimeConfig(buildEnv({ LLM_MODE: "OPENAI" }));

    expect(config.llmMode).toBe("DETERMINISTIC");
  });
});
