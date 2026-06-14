import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { deviceEligibilityForDescription, deviceTypeForDescription } from "@/application/policyRules";

describe("Auditoria extraccion: telefono espanol agrupado 2-2-2-2 (bug 5)", () => {
  for (const reply of ["mi numero es 612 34 56 78", "612 34 56 78"]) {
    it(`extrae el telefono de "${reply}"`, () => {
      const understanding = extractDeterministicUnderstanding(reply, { lastAgentMessage: "Pasame tu numero" });
      expect(understanding.extractedData.phone).toBe("612345678");
    });
  }

  it("con prefijo +34 conserva el codigo de pais (convencion del sistema, igual que +57)", () => {
    const understanding = extractDeterministicUnderstanding("+34 612 34 56 78", { lastAgentMessage: "tu numero?" });
    expect(understanding.extractedData.phone).toBe("34612345678");
  });

  it("sigue extrayendo el formato 3-3-3 clasico", () => {
    const understanding = extractDeterministicUnderstanding("mi numero es 612 345 678", { lastAgentMessage: "tu numero?" });
    expect(understanding.extractedData.phone).toBe("612345678");
  });
});

describe("Auditoria extraccion: Redmi resuelve elegibilidad (bug 6)", () => {
  it("redmi clasifica como Android pendiente de prueba de calidad, no UNKNOWN", () => {
    expect(deviceTypeForDescription("tengo un redmi note 10")).toBe("OTHER");
    expect(deviceEligibilityForDescription("tengo un redmi note 10")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("tengo un redmi")).toBe("PENDING_QUALITY_TEST");
  });
});

describe("Auditoria extraccion: 'of'/'only' ingles no es falso OnlyFans (bug 7)", () => {
  it("no marca hasOnlyFans por 'of'/'only' en frases inglesas", () => {
    for (const message of ["the best of me", "soy fan of you", "out of office"]) {
      const understanding = extractDeterministicUnderstanding(message, {});
      expect(understanding.extractedData.hasOnlyFans).toBeUndefined();
    }
  });

  it("sigue detectando OnlyFans real en castellano", () => {
    for (const message of ["si tengo of", "ya tengo onlyfans", "uso only desde hace un ano"]) {
      const understanding = extractDeterministicUnderstanding(message, {});
      expect(understanding.extractedData.hasOnlyFans).toBe(true);
    }
  });
});

describe("Auditoria extraccion: preguntas coloquiales de dinero (bug 8)", () => {
  for (const message of ["cuanto me llevo yo?", "cuanto me queda a mi?", "y yo cuanto saco?"]) {
    it(`clasifica "${message}" como pregunta de porcentaje`, () => {
      const understanding = extractDeterministicUnderstanding(message, {});
      expect(understanding.intent).toBe("ASKS_ABOUT_PERCENTAGE");
      // Pregunta pura, no negociacion: no escala.
      expect(understanding.requiresHumanReview).toBe(false);
    });
  }
});
