import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decisiones de Alex 27-jun:
// - GENERO: la agencia trabaja SOLO con chicas. Preguntar por hombres / "solo chicas?" -> el bot lo aclara
//   ("Ahora mismo solo trabajamos con chicas"), de forma DETERMINISTA (en prod el LLM contestaba sobre paises).
// - CONTENIDO EXPLICITO ("cosas fuertes"): el bot NO contesta hasta donde llega; ESCALA a Alex ("que me avise").

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
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Genero: solo chicas (Alex 27-jun)", () => {
  it("preguntar por hombres / 'solo chicas?' -> aclara 'solo chicas', SIN escalar", async () => {
    for (const msg of [
      "aceptais hombres tambien o solo chicas?",
      "trabajais con hombres?",
      "esto es solo para chicas?",
      "soy un chico, me aceptais?"
    ]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "gen_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `"${msg}"`).toMatch(/solo trabajamos con chicas/);
      expect(r.candidate.currentState, `no escala "${msg}"`).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    }
  });

  it("una pregunta benigna NO dispara la aclaracion de genero", async () => {
    for (const msg of ["esto es presencial?", "soy de barcelona", "cuanto tiempo hay que dedicarle?"]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "gben_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `"${msg}"`).not.toMatch(/solo trabajamos con chicas/);
    }
  });
});

describe("Contenido explicito 'cosas fuertes' escala a Alex (Alex 27-jun)", () => {
  it("preguntar hasta donde llega el contenido -> HUMAN_INTERVENTION_REQUIRED", async () => {
    for (const msg of [
      "hay que hacer cosas muy fuertes?",
      "tengo que hacer porno?",
      "hay que salir desnuda?",
      "que tan explicito es el contenido?"
    ]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "exp_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.candidate.currentState, `"${msg}"`).toBe("HUMAN_INTERVENTION_REQUIRED");
    }
  });

  it("una pregunta normal de contenido NO escala", async () => {
    const { engine, repository } = mk();
    const c = await seedAdult(repository, "expben_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "que tipo de fotos hay que subir?" }]
    });
    expect(r.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});
