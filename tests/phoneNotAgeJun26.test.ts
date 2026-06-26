import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// QA sweep 26-jun (trampa real, mensaje literal de una candidata): "Si tengo 15 plus iPhone" leia "15" como
// EDAD y CERRABA a una adulta como menor. FIX: "tengo/edad N" no es edad si va seguido de una palabra de MOVIL
// (plus/pro/max/iphone/samsung/...). NO debilita la deteccion de menores ("tengo 15", "tengo 15 anos" siguen).

const askedAge = { lastAgentMessage: "que edad tienes?" } as const;

describe("Un numero de MODELO de movil no se lee como edad (Alex 26-jun, QA sweep)", () => {
  it("'tengo 15 plus iphone' / 'tengo 13 pro' -> NO es edad", () => {
    for (const msg of ["si tengo 15 plus iphone", "tengo 15 plus iphone", "tengo 13 pro", "tengo 12 mini"]) {
      expect(extractDeterministicUnderstanding(msg, askedAge).extractedData?.age, `"${msg}"`).toBeUndefined();
    }
  });

  it("las edades REALES de menor siguen detectandose (invariante 2 intacto)", () => {
    expect(extractDeterministicUnderstanding("tengo 15", askedAge).extractedData?.age).toBe(15);
    expect(extractDeterministicUnderstanding("tengo 15 anos", askedAge).extractedData?.age).toBe(15);
    expect(extractDeterministicUnderstanding("tengo 16", askedAge).extractedData?.age).toBe(16);
    expect(extractDeterministicUnderstanding("tengo 17", askedAge).extractedData?.age).toBe(17);
  });

  it("MOTOR: 'Si tengo 15 plus iPhone' NO cierra a la candidata como menor", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const u = "phone15_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ana" }] });
    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "Si tengo 15 plus iPhone" }] });
    expect(r.candidate.currentState).not.toBe("CLOSED");
    expect(r.response.toLowerCase()).not.toContain("mayores de edad");
  });
});
