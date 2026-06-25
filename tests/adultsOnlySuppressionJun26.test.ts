import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug Alex 26-jun: una candidata ADULTA (45) pregunto "esta bien? o buscais mas menores?" (por preferencia de
// edad) y el bot recito "Ahora mismo solo podemos valorar perfiles de personas mayores de edad" -> sinsentido.
// FIX: a una adulta YA confirmada se le suprime la politica "solo mayores de edad" (la entrada se surfacea por
// la palabra "menores" y el LLM la recitaba). El cierre de una MENOR (otra rama, terminal) NO se ve afectado.

function mk() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

describe("Supresion de 'solo mayores de edad' para adultas confirmadas (Alex 26-jun)", () => {
  it("una adulta confirmada que menciona 'menores' NO recibe la politica 'mayores de edad'", async () => {
    const { engine, repository } = mk();
    const c = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "adult_" + Math.random().toString().slice(2, 6), profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 45,
        isAdultConfirmed: true,
        currentState: "QUALIFYING" as CandidateState
      })
    );
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "esta bien?" }, { content: "o buscais mas menores?" }]
    });
    expect(r.response.toLowerCase()).not.toMatch(/mayores de edad|solo podemos valorar perfiles de personas mayores/);
  });

  it("una MENOR sigue cerrando con la politica de edad (no se suprime el cierre)", async () => {
    const { engine } = mk();
    const r = await engine.handleIncomingTurn({
      instagramUsername: "minor_" + Math.random().toString().slice(2, 6),
      profileVisibility: "PUBLIC",
      messages: [{ content: "hola tengo 17 anos" }]
    });
    expect(r.candidate.currentState).toBe("CLOSED");
    expect(r.response.toLowerCase()).toContain("mayores de edad");
  });
});
