import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regla de Alex (6-jul, chat real Dane): Rose Models solo gestiona OnlyFans. Si la candidata BUSCA/se pasa
// a Fansly u otra plataforma EN VEZ de OF, es un no-fit claro -> se cierra con educacion, sin insistirle con
// el modelo espanol. PERO si solo PREGUNTA "trabajan con Fansly?" (sin rechazar OF) se le responde "solo
// OnlyFans" y se SIGUE (por si le vale OF): no se pierde el lead.

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

async function seedQualifying(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Dane",
      age: 33,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("No-fit por plataforma: busca Fansly en vez de OF -> cierra (Alex 6-jul, Dane)", () => {
  it("'ya me gestiono mi only, estoy buscando para fansly' -> CLOSED con cierre amable", async () => {
    const { engine, repository } = mk();
    const c = await seedQualifying(repository, "dane_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "yo ya me gestiono mi only, estoy buscando para fansly" }]
    });
    expect(r.candidate.currentState).toBe("CLOSED");
    expect(r.response.toLowerCase()).toMatch(/onlyfans|suerte/);
  });

  it("solo PREGUNTA 'trabajan con fansly?' -> NO cierra (se sigue, por si le vale OF)", async () => {
    const { engine, repository } = mk();
    const c = await seedQualifying(repository, "ask_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "trabajan con fansly?" }]
    });
    expect(r.candidate.currentState).not.toBe("CLOSED");
  });

  // BLOQUEANTE cazado por el revisor 6-jul: NO cerrar a las que se pasan DE Fansly A OnlyFans (el lead ideal).
  it("DIRECCION: la que se pasa de Fansly A OnlyFans NUNCA se cierra (es el mejor lead)", async () => {
    const casos = [
      "estoy migrando de fansly a only",
      "deje de buscar en fansly y me vine a only",
      "buscando agencia, tengo fansly y quiero only",
      "quiero empezar en only pero tambien tengo fansly",
      "empezar en onlyfans, antes probe fansly"
    ];
    for (const msg of casos) {
      const { engine, repository } = mk();
      const c = await seedQualifying(repository, "dir_" + Math.random().toString().slice(2, 8));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.candidate.currentState, `"${msg}" NO debe cerrar (viene a OF)`).not.toBe("CLOSED");
    }
  });
});
