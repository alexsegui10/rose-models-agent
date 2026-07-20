import { describe, expect, it } from "vitest";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// Barrido de voz 20-jul (persona "cara"): la candidata muy insistente con la cara oía ~8 veces casi la misma
// frase (el pool RECONDUCT_FACE tenía 4 variantes y a la 5ª se repetía clavada = tell de IA). Ampliado a 7
// variantes: misma política (cara imprescindible + acompañamiento), distinto fraseo. TODAS deben pasar el
// validador de voz y NINGUNA prometer ocultar/tapar la cara (invariante DURO de la cara, guard promisesFaceConcealment).

function reconduct(i: number): string {
  const plan = planCallUtterance({ directive: { type: "RECONDUCT_FACE" }, repetitionIndex: i } as never);
  return plan.deterministicText ?? plan.fallbackText ?? "";
}

describe("RECONDUCT_FACE: más variantes (no repite clavado), todas seguras", () => {
  it("las primeras 7 formulaciones son DISTINTAS (no se repite hasta la 8ª)", () => {
    const texts = Array.from({ length: 7 }, (_, i) => reconduct(i));
    expect(new Set(texts).size).toBe(7);
    // la 8ª cicla de vuelta a la 1ª (pool de 7).
    expect(reconduct(7)).toBe(reconduct(0));
  });

  it("TODAS las variantes pasan el validador de voz (no prometen ocultar la cara, sin cifras/promesas)", () => {
    for (let i = 0; i < 7; i++) {
      const text = reconduct(i);
      expect(validateCallUtterance(text).valid, `variante ${i}: ${text}`).toBe(true);
    }
  });

  it("NINGUNA variante suaviza el requisito ni ofrece ocultar la cara", () => {
    for (let i = 0; i < 7; i++) {
      const t = reconduct(i).toLowerCase();
      // transmite que la cara es OBLIGATORIA (varios fraseos aprobados, no solo la palabra literal).
      expect(t, `variante ${i}`).toMatch(/imprescindible|no es algo que podamos quitar|es la base de que/);
      // y NUNCA ofrece ocultarla (invariante DURO de la cara).
      expect(t, `variante ${i}`).not.toMatch(/tapar|difumin|ocultar|no se te ve|sin mostrar|anonim|de espaldas|filtro|mascara/);
    }
  });
});
