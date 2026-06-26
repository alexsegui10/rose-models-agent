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

// Panel adversarial (hunt 26-jun): la objecion "puedo trabajar SIN mostrar la cara?" se oia AL REVES: el
// faceAcceptancePattern casaba "puedo...mostrar" y, como el patron de rechazo no cubria "sin mostrar la cara",
// faceAccepted()=true -> el bot trataba una NEGATIVA como un SI y avanzaba. FIX: faceRefusalSignalPattern cubre
// "sin (mostrar|ensenar) (la/mi) cara" y "sin que se (me) vea (la) cara". Arregla las dos mitades (deja de
// devolver null Y deja de contarla como aceptacion). La 1a objecion SOLO reconduce, NUNCA cierra.
describe("Objecion de cara 'sin mostrar la cara' reconduce y no cierra (panel hunt 26-jun)", () => {
  it("'sin (mostrar/ensenar) la cara' / 'sin que se vea la cara' -> reconduce, sigue en QUALIFYING (no CLOSED)", async () => {
    for (const msg of [
      "puedo trabajar sin mostrar la cara?",
      "se puede trabajar sin ensenar la cara?",
      "quiero trabajar sin que se vea la cara",
      "prefiero trabajar sin mostrar mi cara"
    ]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "sinm_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `reconduce "${msg}"`).toMatch(/imprescindible|muchas chicas|trafico|privacidad/);
      expect(r.candidate.currentState, `no cierra "${msg}"`).not.toBe("CLOSED");
    }
  });
});
