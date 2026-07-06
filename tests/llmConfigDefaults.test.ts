import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

function buildEnv(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("getLlmRuntimeConfig", () => {
  it("defaults (Alex 6-jul): TODO en mini en Hobby por latencia; gpt-5.4 se activa por entorno en Pro", () => {
    const config = getLlmRuntimeConfig(buildEnv());

    // En Vercel Hobby (turno 8.5s, tope 4s/llamada) el gpt-5.4 completo se pasa del timeout de forma
    // intermitente -> fallback robotico "a veces si a veces no". mini es rapido y consistente.
    expect(config.writingModel).toBe("gpt-5.4-mini");
    expect(config.understandingModel).toBe("gpt-5.4-mini");
    expect(config.callWritingModel).toBe("gpt-5.4-mini");
  });

  it("en Vercel Pro se sube el texto a gpt-5.4 completo por entorno (una variable)", () => {
    const config = getLlmRuntimeConfig(buildEnv({ OPENAI_WRITING_MODEL: "gpt-5.4" }));
    expect(config.writingModel).toBe("gpt-5.4");
    // La voz y la comprension NO heredan: siguen en mini salvo que se pidan aparte.
    expect(config.callWritingModel).toBe("gpt-5.4-mini");
    expect(config.understandingModel).toBe("gpt-5.4-mini");
  });

  it("respeta los modelos definidos por entorno", () => {
    const config = getLlmRuntimeConfig(
      buildEnv({
        OPENAI_UNDERSTANDING_MODEL: "gpt-5.4-nano",
        OPENAI_WRITING_MODEL: "gpt-5.4-mini",
        OPENAI_CALL_MODEL: "gpt-5.4-nano"
      })
    );

    expect(config.understandingModel).toBe("gpt-5.4-nano");
    expect(config.writingModel).toBe("gpt-5.4-mini");
    expect(config.callWritingModel).toBe("gpt-5.4-nano");
  });

  it("cae a DETERMINISTIC si se pide OPENAI sin clave", () => {
    const config = getLlmRuntimeConfig(buildEnv({ LLM_MODE: "OPENAI" }));

    expect(config.llmMode).toBe("DETERMINISTIC");
  });
});
