import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function age(message: string): number | undefined {
  return extractDeterministicUnderstanding(message, { lastAgentMessage: "Que edad tienes?" }).extractedData.age;
}

async function stateFor(message: string): Promise<{ state: string; adult: boolean }> {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  const result = await engine.handleIncomingMessage({
    instagramUsername: "cumplir_case",
    profileVisibility: "PUBLIC",
    message
  });
  return { state: result.candidate.currentState, adult: result.candidate.isAdultConfirmed };
}

describe("Edad por 'cumplir': pasado SI es edad, futuro/intencion NUNCA confirma adulta (invariante 2)", () => {
  // PASADO: cumpleanos ya ocurrido -> es su edad real.
  it("cumpleanos pasado de adulta extrae la edad", () => {
    expect(age("acabo de cumplir 18")).toBe(18);
    expect(age("recien cumpli 18")).toBe(18);
    expect(age("cumpli 18 hace nada")).toBe(18);
    expect(age("ya cumpli 21")).toBe(21);
    expect(age("he cumplido 19")).toBe(19);
  });

  it("cumpleanos pasado de menor cierra (CLOSED)", async () => {
    for (const message of ["acabo de cumplir 16", "cumpli 17 hace nada"]) {
      const { state, adult } = await stateFor(message);
      expect(state).toBe("CLOSED");
      expect(adult).toBe(false);
    }
  });

  // FUTURO / INTENCION: aun NO los tiene -> JAMAS adulta (es el bloqueante que detecto el revisor).
  const futureTurning18 = [
    "voy a cumplir 18 el mes que viene",
    "pronto cumplo 18",
    "estoy a punto de cumplir 18",
    "cuando cumpla 18 te aviso",
    "cumplire 18 pronto",
    "manana cumplo 18",
    "el viernes cumplo 18",
    "en dos semanas cumplo 18"
  ];

  for (const message of futureTurning18) {
    it(`futuro "${message}" NUNCA se lee como adulta de 18`, () => {
      const a = age(message);
      expect(a === undefined || a < 18).toBe(true);
    });
    it(`futuro "${message}" no confirma adulta a nivel motor`, async () => {
      const { adult } = await stateFor(message);
      expect(adult).toBe(false);
    });
  }

  // Una adulta clara con cifra explicita delante no se ve afectada por la cautela del futuro.
  it("'tengo 25, voy a cumplir 26 pronto' sigue siendo adulta de 25", async () => {
    expect(age("tengo 25, voy a cumplir 26 pronto")).toBe(25);
    const { state } = await stateFor("tengo 25, voy a cumplir 26 pronto");
    expect(state).not.toBe("CLOSED");
  });

  // Aniversarios laborales/personales con "cumplir N anos como/de/en" NO son edad: no deben cerrar a
  // una adulta como menor (regresion detectada por el revisor: la cautela de futuro no debe tragarse
  // un "10 anos como modelo").
  it("aniversarios ('cumplo N anos como/de/en ...') no cierran a la adulta", async () => {
    for (const message of [
      "tengo 25 y pronto cumplo 10 anos como modelo",
      "tengo 30, voy a cumplir 5 anos en esto",
      "tengo 28 y el viernes cumplo 8 anos de novia"
    ]) {
      const { state } = await stateFor(message);
      expect(state).not.toBe("CLOSED");
    }
  });

  // Pero "voy a cumplir 18 anos" SI es edad (turning 18 -> aun 17 -> menor).
  it("'voy a cumplir 18 anos' se trata como menor (aun 17)", () => {
    const a = age("voy a cumplir 18 anos el mes que viene");
    expect(a !== undefined && a < 18).toBe(true);
  });
});
