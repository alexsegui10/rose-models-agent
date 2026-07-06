import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

function buildEnv(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("getLlmRuntimeConfig", () => {
  it("defaults (decision Alex 5-jul): redaccion de TEXTO en gpt-5.4 completo; comprension y VOZ en mini", () => {
    const config = getLlmRuntimeConfig(buildEnv());

    // Redaccion de texto en el modelo GRANDE: el mini producia respuestas planas ("no esta vivo").
    expect(config.writingModel).toBe("gpt-5.4");
    // Comprension en mini (extraccion estructurada + merge determinista; la latencia manda).
    expect(config.understandingModel).toBe("gpt-5.4-mini");
    // La LLAMADA de voz se queda en mini: cada turno debe salir en <3.5s o la llamada se siente muerta.
    expect(config.callWritingModel).toBe("gpt-5.4-mini");
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
