import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Alex 25-jun: "48" (un turno) y luego "es demasiado?" (otro turno). El bot ignoraba la pregunta de encaje y
// pasaba al movil (o soltaba la cara, porque face-requirement comparte categoria con la edad). FIX: una duda de
// encaje por edad, con edad ADULTA ya conocida, se RESPONDE confirmando su edad (determinista), antes que nada.

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
      age: 48,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Duda de encaje por edad con edad adulta conocida (Alex 25-jun)", () => {
  for (const doubt of ["es demasiado?", "es suficiente?", "sirvo para esto?", "no soy muy mayor?"]) {
    it(`"${doubt}" tras dar 48 -> confirma la edad, no la ignora ni habla de la cara`, async () => {
      const { engine, repository } = mk();
      const seeded = await seedAdult(repository, "fit_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingMessage({
        candidateId: seeded.id,
        instagramUsername: seeded.instagramUsername,
        message: doubt
      });
      expect(r.response.toLowerCase()).toMatch(/48|encaj|maduro|sin problema|por la edad/);
      expect(r.response.toLowerCase()).not.toMatch(/\bcara\b|rostro/);
    });
  }

  it("una objecion de REPARTO con cifra ('es demasiado el 70%?') NO se desvia a respuesta de edad (invariante 3)", async () => {
    const { engine, repository } = mk();
    const seeded = await seedAdult(repository, "fit_pct_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "es demasiado el 70%?"
    });
    // NO debe responder con la plantilla de encaje por edad (desviaria una pregunta de dinero a una de edad).
    expect(r.response.toLowerCase()).not.toMatch(/buscamos sobre todo perfiles maduros/);
  });

  it("la duda de edad JUNTO al numero en el mismo turno ('48 es demasiado?') tambien confirma la edad", async () => {
    const { engine } = mk();
    const u = "fit_grp_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ana" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "48" }, { content: "es demasiado?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/48|encaj|maduro|sin problema|por la edad/);
  });
});
