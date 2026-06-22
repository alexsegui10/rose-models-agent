import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";

// Arreglos de conversación (feedback de Alex 22-jun): confirmar el móvil válido (responder su "te sirve?")
// y partir la pregunta del móvil en 2 mensajes (no un párrafo largo).

function setup() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

async function seedQualifying(repository: InMemoryCandidateRepository, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `conv_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 35,
      isAdultConfirmed: true,
      currentState: "QUALIFYING",
      ...overrides
    })
  );
}

describe("Conversación 22-jun: confirmar móvil + partir la pregunta del móvil", () => {
  it("da un movil VALIDO (iphone 13) -> confirma 'con ese movil perfecto' y sigue al guion", async () => {
    const { engine, repository } = setup();
    const seeded = await seedQualifying(repository);
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "tengo un iphone 13, te sirve?"
    });
    expect(reply.response.toLowerCase()).toContain("ese movil perfecto");
    // No se queda en la confirmacion: sigue el guion (pregunta lo siguiente, OF).
    expect(reply.response.toLowerCase()).toMatch(/of\b/);
  });

  it("la pregunta del movil va en 2 mensajes (no un parrafo largo)", async () => {
    const { engine, repository } = setup();
    // Candidata con nombre+edad pero SIN movil -> el siguiente slot es el movil.
    const seeded = await seedQualifying(repository);
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "vale"
    });
    expect(reply.response.toLowerCase()).toContain("que movil tienes");
    expect(reply.response.toLowerCase()).toContain("importante para la calidad");
    // La pregunta + el porque salen como mensajes separados (la rafaga los parte).
    const burst = splitIntoMessageBurst(reply.response);
    expect(burst.length).toBeGreaterThanOrEqual(2);
    expect(burst.some((m) => /que movil tienes/i.test(m) && !/importante/i.test(m))).toBe(true);
  });
});
