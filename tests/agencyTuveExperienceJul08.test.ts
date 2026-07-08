import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug real 8-jul (Tania): a "has trabajado con otras agencias?" respondio "tuve una pesima experiencia con
// una agencia". El extractor no reconocia "tuve" (solo trabaje/he trabajado/estuve) -> worksWithAnotherAgency
// quedaba undefined -> RE-PREGUNTABA agencias Y el guion esencial nunca se completaba (la candidata quedaba
// colgada cuando gpt fallaba justo ahi). Un "tuve/tenia (una mala) experiencia con una agencia" es un SI.

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
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo tania" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "31" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14 pro" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "si, casi 3 años de experiencia" }] });
}

describe("Agencia: 'tuve una (mala) experiencia con una agencia' es un SI (bug Tania 8-jul)", () => {
  for (const answer of [
    "tuve una mala experiencia con una agencia",
    "tuve una pesima experiencia con una agencia",
    "si, tuve una experiencia con otra agencia",
    "tenia una agencia antes pero lo deje"
  ]) {
    it(`"${answer}" -> worksWithAnotherAgency = true`, async () => {
      const { engine } = mk();
      const u = "tuve_" + Math.random().toString().slice(2, 8);
      await toAgenciesQuestion(engine, u);
      const res = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: answer }] });
      expect(res.candidate.worksWithAnotherAgency).toBe(true);
    });
  }

  it("NEGACION: 'no tuve experiencia con agencias' -> false (no se invierte)", async () => {
    const { engine } = mk();
    const u = "notuve_" + Math.random().toString().slice(2, 8);
    await toAgenciesQuestion(engine, u);
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "no, nunca tuve experiencia con agencias" }]
    });
    expect(res.candidate.worksWithAnotherAgency).toBe(false);
  });

  it("OFF-TOPIC: 'tuve un mal dia' NO marca que trabajo con agencia (no falso positivo)", async () => {
    const { engine } = mk();
    const u = "malmdia_" + Math.random().toString().slice(2, 8);
    await toAgenciesQuestion(engine, u);
    const res = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "uf tuve un mal dia hoy" }] });
    expect(res.candidate.worksWithAnotherAgency).not.toBe(true);
  });
});
