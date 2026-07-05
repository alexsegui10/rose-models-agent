import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";

// Casos REALES Vanesa (5-jul), bugs del fallback determinista que rompían la conversación:
// (1) "buenas tardes soy, Vanesa" -> la coma tras "soy" tiraba el nombre y el bot repreguntaba en bucle.
// (2) "Un gusto Alex!" -> la palabra "alex" (¡el nombre del propio bot!) escalaba a humano y enmudecía.

describe("nombre con coma tras 'soy'", () => {
  it("'buenas tardes soy, Vanesa' -> capta 'Vanesa'", () => {
    const u = extractDeterministicUnderstanding("Buenas tardes soy, Vanesa", { lastAgentMessage: "como te llamas?" });
    expect(u.extractedData.firstName).toBe("Vanesa");
  });
  it("regresión: 'soy vanesa' (sin coma) sigue captando", () => {
    const u = extractDeterministicUnderstanding("soy vanesa", { lastAgentMessage: "como te llamas?" });
    expect(u.extractedData.firstName).toBe("Vanesa");
  });
  it("regresión: 'soy de argentina' / 'soy modelo' NO se toman como nombre (filtro de stopwords/lugares)", () => {
    const u1 = extractDeterministicUnderstanding("soy de argentina", { lastAgentMessage: "como te llamas?" });
    expect(u1.extractedData.firstName).toBeUndefined();
  });
});

describe("saludo + nombre en la misma burbuja ('Hola silvana') capta el nombre (caso silvana 5-jul)", () => {
  for (const [msg, expected] of [
    ["hola silvana", "Silvana"],
    ["buenas ana", "Ana"],
    ["hola sofia", "Sofia"]
  ] as const) {
    it(`'${msg}' -> ${expected} (salta el saludo, no repregunta el nombre)`, () => {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "Para empezar, como te llamas?" });
      expect(u.extractedData.firstName).toBe(expected);
    });
  }
  it("regresión: un saludo sin nombre ('buenas tardes', 'hola') NO inventa un nombre", () => {
    for (const msg of ["buenas tardes", "hola", "buenos dias"]) {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "como te llamas?" });
      expect(u.extractedData.firstName, msg).toBeUndefined();
    }
  });
  it("regresión: un ACUSE ('vale dale', 'dale') NO se toma como nombre (solo se salta un SALUDO)", () => {
    for (const msg of ["vale dale", "dale", "vale"]) {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "como te llamas?" });
      expect(u.extractedData.firstName, msg).toBeUndefined();
    }
  });
});

describe("saludar al bot por su nombre (Alex) NO es pedir un humano", () => {
  for (const msg of ["Un gusto Alex!", "Hola Alex", "Gracias Alex", "que tal alex"]) {
    it(`'${msg}' -> NO escala a REQUESTS_HUMAN`, () => {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "Para empezar, como te llamas?" });
      expect(u.intent).not.toBe("REQUESTS_HUMAN");
    });
  }
  it("regresión: pedir un humano DE VERDAD sigue escalando", () => {
    for (const msg of ["quiero hablar con una persona", "prefiero hablar con un humano", "hablar con alguien del equipo"]) {
      const u = extractDeterministicUnderstanding(msg, { lastAgentMessage: "hola" });
      expect(u.intent, msg).toBe("REQUESTS_HUMAN");
    }
  });
});
