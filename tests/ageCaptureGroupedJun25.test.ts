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

  // BLOQUEANTE (dos pasadas del revisor): una MENOR borde que aun NO cumple 18 (el numero DELANTE de la
  // coletilla de futuro) NO puede leerse como adulta. Regla de FRONTERA (no lista negra, que siempre tiene
  // fugas): el 18 solo se lee como adulta si NO hay coletilla con texto -> cualquier letra detras = limbo.
  it("una menor borde de 18 con coletilla de futuro NO se lee como adulta -> limbo (invariante 2)", () => {
    for (const msg of [
      "18 casi los cumplo",
      "18 voy a cumplir",
      "18 pero todavia no",
      "18 en dos meses",
      "18 los cumplo en mayo",
      // fugas que la lista negra dejaba pasar (2a pasada del revisor):
      "18 en julio",
      "18 en un mes",
      "18 dentro de poco",
      "18 menos un mes",
      "18 me faltan dias",
      "18 me falta poco",
      "18 los hago en agosto",
      "18 el dia 5"
    ]) {
      expect(extractDeterministicUnderstanding(msg, askedAge).extractedData?.age).toBeUndefined();
    }
  });

  it("'18' sola (o con coletilla NO textual) SI es adulta; 19+ se leen pase lo que pase tras el numero", () => {
    for (const msg of ["18", "18!", "18 :)", "edad: 18", "18 años"]) {
      expect(extractDeterministicUnderstanding(msg, askedAge).extractedData?.age).toBe(18);
    }
    // 19+ no se vuelve menor por ninguna coletilla -> la cura sigue (y "30 en julio" sigue siendo 30).
    expect(extractDeterministicUnderstanding("30 en julio", askedAge).extractedData?.age).toBe(30);
    expect(extractDeterministicUnderstanding("48\nes suficiente?", askedAge).extractedData?.age).toBe(48);
    expect(extractDeterministicUnderstanding("48 🎂", askedAge).extractedData?.age).toBe(48);
  });

  // La frontera del 18 es Unicode (\p{L}\p{S}), no solo ASCII: una coletilla de futuro en OTRO alfabeto o un
  // emoji de "pronto los cumplo" (🎂/⏳) tras el 18 tampoco lo lee como adulta (invariante 2, 3a pasada revisor).
  it("el 18 con coletilla en otro alfabeto o emoji de futuro NO se lee como adulta -> limbo", () => {
    for (const msg of ["18 قريبا", "18 πρπ", "18 пока", "18 🎂", "18 ⏳", "18 🥳"]) {
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
