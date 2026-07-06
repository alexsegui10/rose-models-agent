import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug sim 6-jul (Rocio): a "has trabajado con otras agencias?" respondio "Si he trabajado y no he tenido
// la mejor experiencia pero es mucho sola". El "no" de la queja hacia que se extrajera worksWithAnotherAgency
// = false -> se la trataba como INEXPERTA y saltaba el pitch en vez de empatizar. Un "si he trabajado" es un
// SI aunque venga con queja. "Trabaje sola / por mi cuenta" sigue siendo un NO.

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

async function toAgenciesQuestion(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo rocio" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "41" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 13" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "si tengo of" }] });
}

describe("Trabajar con agencia: un 'si he trabajado' con queja es SI (bug Rocio 6-jul)", () => {
  it("'Si he trabajado y no he tenido la mejor experiencia' -> worksWithAnotherAgency = true (no la marca inexperta)", async () => {
    const { engine } = mk();
    const u = "agc_" + Math.random().toString().slice(2, 6);
    await toAgenciesQuestion(engine, u);
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [
        { content: "Si he trabajado y no he tenido la mejor experiencia pero tampoco puedo hacerlo todo sola porque es mucho" }
      ]
    });
    expect(res.candidate.worksWithAnotherAgency).toBe(true);
  });

  it("'trabaje sola por mi cuenta' -> worksWithAnotherAgency = false (sigue siendo un NO)", async () => {
    const { engine } = mk();
    const u = "sola_" + Math.random().toString().slice(2, 6);
    await toAgenciesQuestion(engine, u);
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "no, siempre trabaje sola por mi cuenta" }]
    });
    expect(res.candidate.worksWithAnotherAgency).toBe(false);
  });

  it("un verbo de trabajo OFF-TOPIC ('trabaje de camarera') NO marca que trabajo con una agencia (nota revisor)", async () => {
    const { engine } = mk();
    const u = "offtopic_" + Math.random().toString().slice(2, 6);
    await toAgenciesQuestion(engine, u);
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "mmm antes trabaje de camarera un tiempo" }]
    });
    // No es un SI a "trabajaste con agencias?": no debe marcarse como experimentada por error.
    expect(res.candidate.worksWithAnotherAgency).not.toBe(true);
  });
});
