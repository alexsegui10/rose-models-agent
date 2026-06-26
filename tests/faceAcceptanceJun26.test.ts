import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// QA sweep 26-jun: "te cuento que decidi mostrar mi cara" (un SI, mensaje real) recibia el sermon de objecion
// ("a muchas chicas les pasa al principio... la cara es imprescindible..."). FIX: si la candidata ACEPTA mostrar
// la cara, NO se le recita la politica (ni la version "imprescindible para el trafico"); se acoge y se sigue.
// Las OBJECIONES y la pregunta de anonimato SIGUEN reconduciendo (la cara es imprescindible, sin anonimato).

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

async function seedAdult(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

const FACE_RECITATION = /muchas chicas les pasa|imprescindible|confianza al cliente|anonim/i;

describe("Aceptar mostrar la cara (un SI) no recibe el sermon (Alex 26-jun, QA sweep)", () => {
  it("acepta mostrar la cara -> NO recita la politica de la cara", async () => {
    for (const msg of [
      "te cuento que decidi mostrar mi cara",
      "voy a mostrar la cara sin problema",
      "si muestro la cara",
      "no me importa mostrar la cara"
    ]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "acc_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `"${msg}"`).not.toMatch(FACE_RECITATION);
    }
  });

  it("una OBJECION o pregunta de anonimato SIGUE reconduciendo (la cara es imprescindible)", async () => {
    for (const msg of ["no quiero mostrar la cara", "me da cosa mostrar la cara", "puedo ser anonima?"]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "obj_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `"${msg}"`).toMatch(/cara|imprescindible|trafico|privacidad/);
    }
  });
});
