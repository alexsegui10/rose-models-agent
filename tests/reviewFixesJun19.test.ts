import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";

// Regresiones de la revisión exhaustiva del 19-jun.
describe("revisión 19-jun: extracción de edad y sí/no", () => {
  // Invariante 2 (falso positivo): un contable tras "N" no es la edad; no debe cerrar a una adulta como menor.
  it.each(["no tengo 15 reels todavia", "uff no tengo 18 tatuajes", "tengo 12 publicaciones nada mas", "tengo 16 pedidos"])(
    "no lee como edad un contable: %s",
    (msg) => {
      const out = extractDeterministicUnderstanding(msg);
      expect(out.extractedData.age).toBeUndefined();
    }
  );

  it("una edad real SÍ se sigue leyendo: 'tengo 34 años'", () => {
    const out = extractDeterministicUnderstanding("tengo 34 años");
    expect(out.extractedData.age).toBe(34);
  });

  it("'claro que no, nunca tuve' a la pregunta de OF => hasOnlyFans=false (no SÍ)", () => {
    const out = extractDeterministicUnderstanding("claro que no, nunca tuve", {
      lastAgentMessage: "me puedes contar si has tenido of alguna vez?"
    });
    expect(out.extractedData.hasOnlyFans).toBe(false);
  });

  it("'claro que si tengo' a la pregunta de OF => hasOnlyFans=true", () => {
    const out = extractDeterministicUnderstanding("claro que si tengo una", {
      lastAgentMessage: "tienes of?"
    });
    expect(out.extractedData.hasOnlyFans).toBe(true);
  });

  it("'pues no, nunca' a la pregunta de agencias => worksWithAnotherAgency=false", () => {
    const out = extractDeterministicUnderstanding("pues no, nunca", {
      lastAgentMessage: "has trabajado alguna vez con otras agencias?"
    });
    expect(out.extractedData.worksWithAnotherAgency).toBe(false);
  });
});
