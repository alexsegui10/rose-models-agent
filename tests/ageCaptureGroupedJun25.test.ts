import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug Alex 25-jun: "48" y "es suficiente?" en burbujas distintas (texto unido "48\nes suficiente?") ->
// el LLM A VECES no extraia la edad, candidate.age quedaba undefined, el bot RE-PREGUNTABA la edad y
// derivaba a la cara. CAUSA: bareAgeMessagePattern anclado a TODO el mensaje (^...$) no casa con la
// coletilla. FIX: backstop determinista de edad de CABECERA cuando el agente acaba de preguntar la edad.

const askedAge = { lastAgentMessage: "perfecto. que edad tienes?" } as const;

describe("Extraccion determinista de edad de cabecera (Alex 25-jun)", () => {
  it("captura la edad aunque venga pegada a una coletilla en otra burbuja", () => {
    expect(extractDeterministicUnderstanding("48\nes suficiente?", askedAge).extractedData?.age).toBe(48);
    expect(extractDeterministicUnderstanding("48 es suficiente?", askedAge).extractedData?.age).toBe(48);
    expect(extractDeterministicUnderstanding("edad: 48\nes suficiente", askedAge).extractedData?.age).toBe(48);
  });

  it("una menor en cabecera tambien se captura (invariante 2: se leera <18 y cierra)", () => {
    expect(extractDeterministicUnderstanding("16\nes suficiente?", askedAge).extractedData?.age).toBe(16);
  });

  it("NO confunde numeros que no son edad (invariante 2 / contables / decimales)", () => {
    expect(extractDeterministicUnderstanding("48 cuentas", askedAge).extractedData?.age).toBeUndefined();
    expect(extractDeterministicUnderstanding("48 fotos al dia puedo", askedAge).extractedData?.age).toBeUndefined();
    expect(extractDeterministicUnderstanding("4800 seguidores", askedAge).extractedData?.age).toBeUndefined();
    expect(extractDeterministicUnderstanding("1.80 metros", askedAge).extractedData?.age).toBeUndefined();
    // "no tengo 18" lo resuelve declaredMinorAge (menor ~17), NUNCA mi backstop como adulta 18.
    expect(extractDeterministicUnderstanding("no tengo 18 todavia", askedAge).extractedData?.age).toBe(17);
  });

  it("NO lee un numero de cabecera si el agente NO acaba de preguntar la edad", () => {
    const noAsk = { lastAgentMessage: "hola, que tal estas?" };
    expect(extractDeterministicUnderstanding("48 es suficiente?", noAsk).extractedData?.age).toBeUndefined();
  });

  // BLOQUEANTE que cazo el revisor: una MENOR borde con el numero DELANTE del marcador de "aun no los cumple"
  // ("18 casi los cumplo") NO puede leerse como adulta. declaredMinorAge solo capta el marcador antes del
  // verbo, asi que el backstop debe mandar estos casos al limbo (undefined), NUNCA edad adulta (invariante 2).
  it("una menor borde con el numero delante ('18 casi los cumplo') NO se lee como adulta -> limbo", () => {
    for (const msg of [
      "18 casi los cumplo",
      "18 voy a cumplir",
      "18 pero todavia no",
      "18 en dos meses",
      "18 los cumplo en mayo"
    ]) {
      expect(extractDeterministicUnderstanding(msg, askedAge).extractedData?.age).toBeUndefined();
    }
  });

  it("NO lee la 1a cifra de dos grupos numericos como edad (reparto/telefono/disponibilidad/rango)", () => {
    for (const msg of ["70 30", "50 70 reparto", "18 30 horas libres", "11 2345 6789", "48 50", "48-50"]) {
      expect(extractDeterministicUnderstanding(msg, askedAge).extractedData?.age).toBeUndefined();
    }
  });

  it("NO lee una duracion de cabecera como edad ('8 anios trabajando', typo incluido)", () => {
    expect(extractDeterministicUnderstanding("8 anios trabajando", askedAge).extractedData?.age).toBeUndefined();
    expect(extractDeterministicUnderstanding("25 anos de experiencia", askedAge).extractedData?.age).toBeUndefined();
  });
});

describe("Motor: '48' + 'es suficiente?' agrupado tras preguntar la edad", () => {
  function mk() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    return { engine };
  }

  it("captura la edad y CONFIRMA el encaje, no re-pregunta la edad ni habla de la cara", async () => {
    const { engine } = mk();
    const u = "grp_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "48" }, { content: "es suficiente?" }]
    });
    expect(r.candidate.age).toBe(48);
    expect(r.response.toLowerCase()).toMatch(/48|encaj|maduro|sin problema|por la edad/);
    expect(r.response.toLowerCase()).not.toMatch(/que edad tienes|cuantos anos/);
    expect(r.response.toLowerCase()).not.toMatch(/\bcara\b|rostro/);
  });
});
