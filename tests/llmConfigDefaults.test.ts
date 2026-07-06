import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

function buildEnv(vars: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", ...vars } as NodeJS.ProcessEnv;
}

describe("getLlmRuntimeConfig", () => {
  it("defaults (Alex 6-jul): REDACCION en gpt-5.4 grande (cabe en Hobby, 60s); comprension y voz en mini", () => {
    const config = getLlmRuntimeConfig(buildEnv());

    // Vercel Hobby permite hasta 60s por funcion (no ~10s): el gpt-5.4 de redaccion (~3-8s) cabe con
    // margen y es la mayor palanca de "estar vivo". La comprension (extraccion) y la voz (latencia) siguen
    // en mini a proposito.
    expect(config.writingModel).toBe("gpt-5.4");
    expect(config.understandingModel).toBe("gpt-5.4-mini");
    expect(config.callWritingModel).toBe("gpt-5.4-mini");
  });

  it("timeout por defecto holgado (12s) para que el gpt-5.4 de redaccion no se corte", () => {
    const config = getLlmRuntimeConfig(buildEnv());
    expect(config.timeoutMs).toBe(12000);
  });

  it("se puede bajar la redaccion a mini por entorno (p. ej. para ahorrar o si Hobby diera guerra)", () => {
    const config = getLlmRuntimeConfig(buildEnv({ OPENAI_WRITING_MODEL: "gpt-5.4-mini" }));
    expect(config.writingModel).toBe("gpt-5.4-mini");
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
