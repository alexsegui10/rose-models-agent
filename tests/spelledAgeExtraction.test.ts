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

// Cumpleanos reciente: "recien cumpli 18" / "acabo de cumplir 18" / "cumpli 18 hace nada" son una
// declaracion de edad inequivoca de una adulta de 18, aunque OMITA la palabra "años". Hoy el agePattern
// solo lee "tengo N" o "N años", asi que estos mensajes se quedan en UNCLEAR sin edad y el bot re-pregunta
// la edad en bucle (mismo sintoma que motivo el parser de edad en letra). El verbo "cumplir N" debe
// extraer la edad N e intent PROVIDES_AGE.
describe("extraccion: cumpleanos reciente sin la palabra 'años'", () => {
  it("'recien cumpli 18' -> edad 18 e intent PROVIDES_AGE", () => {
    const out = extractDeterministicUnderstanding("recien cumpli 18");
    expect(out.extractedData.age).toBe(18);
    expect(out.intent).toBe("PROVIDES_AGE");
  });

  it("'acabo de cumplir 18' -> edad 18 e intent PROVIDES_AGE", () => {
    const out = extractDeterministicUnderstanding("acabo de cumplir 18");
    expect(out.extractedData.age).toBe(18);
    expect(out.intent).toBe("PROVIDES_AGE");
  });

  it("'cumpli 18 hace nada' -> edad 18 e intent PROVIDES_AGE", () => {
    const out = extractDeterministicUnderstanding("cumpli 18 hace nada");
    expect(out.extractedData.age).toBe(18);
    expect(out.intent).toBe("PROVIDES_AGE");
  });
});
