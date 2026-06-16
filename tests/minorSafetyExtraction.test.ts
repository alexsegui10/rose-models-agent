import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine };
}

// Invariante 2 (innegociable): una candidata que se declara menor SIEMPRE acaba en CLOSED y NUNCA
// como adulta confirmada. Estos son los fallos reales hallados en la auditoria del 14-jun.
describe("Seguridad de menores: declaracion de minoria -> CLOSED, nunca adulta", () => {
  const minorMessages = [
    "no tengo 18",
    "aun no tengo 18",
    "todavia no tengo 18",
    "no tengo 18 todavia",
    "soy menor",
    "soy menor de edad",
    "aun soy menor",
    "tengo 17 añitos",
    "tengo 17 anitos",
    "tengo dieciseis",
    "tengo quince años",
    "no tengo dieciocho",
    "aun no tengo dieciocho todavia",
    // "cumplir N" tambien cierra a menores (regresion 16-jun: antes "cumplir N" no se leia como edad).
    "acabo de cumplir 16",
    "cumpli 17 hace nada",
    "no he cumplido 18 todavia"
  ];

  for (const message of minorMessages) {
    it(`cierra ante "${message}" y no la confirma como adulta`, async () => {
      const { engine } = createEngine();
      const result = await engine.handleIncomingMessage({
        instagramUsername: "minor_case",
        profileVisibility: "PUBLIC",
        message
      });

      expect(result.candidate.currentState).toBe("CLOSED");
      expect(result.candidate.isAdultConfirmed).toBe(false);
      expect(result.candidate.age === undefined || result.candidate.age < 18).toBe(true);
    });
  }

  it("una menor que da TODOS los datos en un turno recibe el cierre de seguridad, NUNCA el pitch (regresion 15-jun)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "minor_full_script",
      profileVisibility: "PUBLIC",
      message: "me llamo Ana, tengo 16 anos, no tengo of y mi movil es un iphone 13"
    });

    expect(result.candidate.currentState).toBe("CLOSED");
    expect(result.candidate.isAdultConfirmed).toBe(false);
    // JAMAS el pitch de monetizacion del OnlyFans a una menor (invariante 2).
    expect(result.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram|link a tu of/);
    // Cierre de seguridad por minoria de edad.
    expect(result.response.toLowerCase()).toContain("mayores de edad");
  });

  it("NO confirma adulta ante 'no tengo 18' (el peor fallo: leer 'tengo 18')", () => {
    const understanding = extractDeterministicUnderstanding("no tengo 18", { lastAgentMessage: "Que edad tienes?" });
    expect(understanding.extractedData.age === undefined || understanding.extractedData.age < 18).toBe(true);
  });

  it("lee una edad pelada con puntuacion/emoji tras preguntar la edad ('17!')", () => {
    for (const reply of ["17!", "17 :)", "17.", "edad: 17"]) {
      const understanding = extractDeterministicUnderstanding(reply, { lastAgentMessage: "Que edad tienes?" });
      expect(understanding.extractedData.age).toBe(17);
    }
  });
});

describe("Seguridad de menores: las adultas siguen pasando (sin falsos cierres)", () => {
  const adultMessages = ["tengo 25", "tengo 18", "tengo 22 años", "tengo 19 añitos"];

  for (const message of adultMessages) {
    it(`NO cierra ante "${message}"`, async () => {
      const { engine } = createEngine();
      const result = await engine.handleIncomingMessage({
        instagramUsername: "adult_case",
        profileVisibility: "PUBLIC",
        message
      });
      expect(result.candidate.currentState).not.toBe("CLOSED");
    });
  }

  it("'no tengo 21' no se interpreta como menor (es ~adulta), no cierra", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "adult_negated",
      profileVisibility: "PUBLIC",
      message: "no tengo 21 todavia"
    });
    expect(result.candidate.currentState).not.toBe("CLOSED");
  });
});
