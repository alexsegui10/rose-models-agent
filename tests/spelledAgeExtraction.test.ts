import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";

// La edad escrita en LETRA de una adulta ("tengo veintidos") debe parsearse, para no quedarse en bucle
// re-preguntando la edad (hallazgo jueces 16-jun). Sin romper el cierre de menores ni leer duraciones.

describe("extraccion: edad en letra (adultas)", () => {
  it("parsea 'tengo veintidos' como 22", () => {
    expect(extractDeterministicUnderstanding("tengo veintidos").extractedData.age).toBe(22);
  });

  it("parsea una respuesta suelta 'veintidos' como 22", () => {
    expect(extractDeterministicUnderstanding("veintidos", { lastAgentMessage: "Que edad tienes?" }).extractedData.age).toBe(22);
  });

  it("parsea compuestos 'tengo treinta y cinco' como 35", () => {
    expect(extractDeterministicUnderstanding("tengo treinta y cinco").extractedData.age).toBe(35);
  });

  it("parsea 'tengo dieciocho' como 18 (adulta)", () => {
    expect(extractDeterministicUnderstanding("tengo dieciocho").extractedData.age).toBe(18);
  });

  it("NO confunde una duracion en letra con la edad ('llevo veinte años en esto')", () => {
    expect(extractDeterministicUnderstanding("llevo veinte años en esto").extractedData.age).toBeUndefined();
  });

  it("sigue cerrando menores en letra ('tengo dieciseis' -> 16)", () => {
    const age = extractDeterministicUnderstanding("tengo dieciseis").extractedData.age;
    expect(age).toBe(16);
    expect(age !== undefined && age < 18).toBe(true);
  });

  it("NEGACION en letra: 'no tengo dieciocho' NUNCA es adulta de 18 (invariante 2)", () => {
    for (const message of [
      "no tengo dieciocho",
      "aun no tengo dieciocho todavia",
      "no tengo dieciocho anos",
      "no tengo aun dieciocho"
    ]) {
      const age = extractDeterministicUnderstanding(message).extractedData.age;
      expect(age).not.toBe(18);
      expect(age === undefined || age < 18).toBe(true);
    }
  });

  it("NO cierra por error 'no tengo dieciocho mil seguidores' (eso es followers, no edad)", () => {
    const age = extractDeterministicUnderstanding("no tengo dieciocho mil seguidores todavia").extractedData.age;
    expect(age).toBeUndefined();
  });
});
