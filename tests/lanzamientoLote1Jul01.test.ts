import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

// Regresiones del Lote 1 de la auditoría pre-lanzamiento (jul-2026).
describe("llmConfig: presupuesto de OpenAI compatible con el techo de 10s de Vercel", () => {
  it("defaults seguros: 4000ms y 0 reintentos (antes 8000/1 reventaba la lambda)", () => {
    const config = getLlmRuntimeConfig({} as unknown as NodeJS.ProcessEnv);
    expect(config.timeoutMs).toBe(4000);
    expect(config.maxRetries).toBe(0);
  });

  it("BUG arreglado: OPENAI_MAX_RETRIES=0 se respeta (antes '0' caía al fallback 1)", () => {
    const config = getLlmRuntimeConfig({ OPENAI_MAX_RETRIES: "0", OPENAI_TIMEOUT_MS: "3000" } as unknown as NodeJS.ProcessEnv);
    expect(config.maxRetries).toBe(0);
    expect(config.timeoutMs).toBe(3000);
  });

  it("valores inválidos caen a los defaults seguros", () => {
    const config = getLlmRuntimeConfig({ OPENAI_MAX_RETRIES: "-2", OPENAI_TIMEOUT_MS: "abc" } as unknown as NodeJS.ProcessEnv);
    expect(config.maxRetries).toBe(0);
    expect(config.timeoutMs).toBe(4000);
  });
});
