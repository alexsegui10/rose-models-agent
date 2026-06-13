import { describe, expect, it } from "vitest";
import { safeFallbackResponse } from "@/application/responseValidator";
import { safeFactualFallback } from "@/application/factualValidator";

// Regresion taxonomia nº7 iteracion 2 (r5 T3/T5, voice-killing): los fallbacks deterministas
// rompian el registro de Alex con lenguaje de atencion al cliente ("Gracias por escribirme. Lo
// reviso un momento y te contesto con calma."). Deben sonar a Alex: corto, informal, sin tono
// corporativo, derivando honestamente al socio cuando hay que consultarlo.

const corporatePhrases = [/gracias por escribirme/i, /te contesto con calma/i, /lo reviso un momento/i, /nuestro equipo/i];

describe("safe fallbacks keep Alex's register (no corporate customer-service tone)", () => {
  it("the response-validator fallback never uses corporate customer-service phrasing", () => {
    const fallback = safeFallbackResponse();
    for (const phrase of corporatePhrases) {
      expect(fallback).not.toMatch(phrase);
    }
  });

  it("the response-validator fallback stays short and defers to the socio honestly", () => {
    const fallback = safeFallbackResponse();
    expect(fallback.length).toBeLessThanOrEqual(120);
    expect(fallback.toLowerCase()).toContain("socio");
  });

  it("the factual fallback already defers to the socio without corporate phrasing", () => {
    const fallback = safeFactualFallback();
    expect(fallback.toLowerCase()).toContain("socio");
    for (const phrase of corporatePhrases) {
      expect(fallback).not.toMatch(phrase);
    }
  });
});
