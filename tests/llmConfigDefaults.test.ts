import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

function buildEnv(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("getLlmRuntimeConfig", () => {
  it("defaults: REDACCION de texto en gpt-5.6-terra; VOZ en gpt-5.6-luna; comprension en mini", () => {
    const config = getLlmRuntimeConfig(buildEnv());

    // Texto en gpt-5.6-terra (Alex 18-jul). La VOZ baja a gpt-5.6-luna reasoning=low (bench 20-jul: ~2x más
    // rápida y consistente que gpt-5.4). La comprension sigue en mini.
    expect(config.writingModel).toBe("gpt-5.6-terra");
    expect(config.understandingModel).toBe("gpt-5.4-mini");
    expect(config.callWritingModel).toBe("gpt-5.6-luna");
  });

  it("timeout por defecto holgado (12s) para que el gpt-5.4 de redaccion no se corte", () => {
    const config = getLlmRuntimeConfig(buildEnv());
    expect(config.timeoutMs).toBe(12000);
  });

  it("se puede bajar la redaccion a mini por entorno (p. ej. para ahorrar o si Hobby diera guerra)", () => {
    const config = getLlmRuntimeConfig(buildEnv({ OPENAI_WRITING_MODEL: "gpt-5.4-mini" }));
    expect(config.writingModel).toBe("gpt-5.4-mini");
    // La voz NO hereda de OPENAI_WRITING_MODEL: sigue con su default (gpt-5.6-luna) salvo OPENAI_CALL_MODEL.
    // La comprension sigue en mini.
    expect(config.callWritingModel).toBe("gpt-5.6-luna");
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
