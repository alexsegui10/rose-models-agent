import { describe, expect, it } from "vitest";
import { getLlmRuntimeConfig } from "@/application/llmConfig";

// Regresiones del Lote 1 de la auditoría pre-lanzamiento (jul-2026).
// Actualizado 6-jul: el techo real de Vercel Hobby son 60s (no ~10s), asi que el default de timeout sube
// a 12000ms para dar sitio al gpt-5.4 de redaccion. Se mantiene la regresion real que guardaban estos
// tests: 0 reintentos parseado correctamente + valores invalidos caen al default.
describe("llmConfig: presupuesto de OpenAI holgado bajo el techo de 60s de Vercel Hobby", () => {
  it("defaults: 12000ms y 0 reintentos (12s cabe de sobra en los 60s de Hobby; 0 reintentos -> fallback)", () => {
    const config = getLlmRuntimeConfig({} as unknown as NodeJS.ProcessEnv);
    expect(config.timeoutMs).toBe(12000);
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
    expect(config.timeoutMs).toBe(12000);
  });
});
