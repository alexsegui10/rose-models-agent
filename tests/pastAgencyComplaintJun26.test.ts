import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ModelConversationOutputSchema, type ConversationUnderstandingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decision de Alex (26-jun): si la candidata cuenta que OTRA agencia la estafo / le pagaba poco (no os acusa a
// vosotros), el bot TRANQUILIZA y SIGUE, NO escala a revision. La escalada por desconfianza/agresion HACIA
// VOSOTROS ("sois una estafa", "no me fio de vosotros", insultos) o por persona/inyeccion se MANTIENE.

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
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Queja de agencia PASADA vs desconfianza hacia nosotros (Alex 26-jun)", () => {
  it("'me estafaron / me pagaban muy poco' (otra agencia) NO escala a revision", async () => {
    const { engine, repository } = mk();
    const c = await seedAdult(repository, "past_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "si pero me estafaron" }, { content: "me pagaban muy poco" }]
    });
    expect(r.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("desconfianza HACIA NOSOTROS ('esto es una estafa, no me fio de vosotros') SI escala", async () => {
    const { engine, repository } = mk();
    const c = await seedAdult(repository, "us_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "esto es una estafa, no me fio de vosotros" }]
    });
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("queja pasada PERO pide hablar con una persona -> SI escala (persona manda)", async () => {
    const { engine, repository } = mk();
    const c = await seedAdult(repository, "human_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "me estafaron en otra agencia, quiero hablar con una persona" }]
    });
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});

// Modo PROD: cuando OpenAI marca requiresHumanReview por la palabra "estafa", el override NO debe tragarse una
// desconfianza dirigida a NOSOTROS aunque se exprese con verbos fuera de la lista basica (riesgo que cazo el
// revisor 26-jun). Se simula al LLM con un provider fake que escala SIEMPRE.
const escalatingLlm: ConversationUnderstandingProvider = {
  async understand() {
    return ModelConversationOutputSchema.parse({
      intent: "OTHER",
      confidence: 0.6,
      suggestedStateTransition: null,
      requiresHumanReview: true,
      humanReviewReason: "Acusacion de estafa/fraude y desconfianza",
      response: ""
    });
  }
};

describe("Override de queja pasada con el LLM escalando (modo prod simulado)", () => {
  function mkLlm() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: escalatingLlm,
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    return { engine, repository };
  }

  it("aunque el LLM escale, una queja pasada PURA no escala; la desconfianza hacia NOSOTROS si", async () => {
    const cases: [string, boolean][] = [
      ["si pero me estafaron, me pagaban muy poco", false],
      ["me estafaron y desconfio de vosotros", true],
      ["me estafaron y no me creo nada de lo que decis", true],
      ["me estafaron y sospecho mucho de vosotros", true],
      ["me estafaron y esto me da mala espina", true],
      ["me estafaron y me dais 40%?", true]
    ];
    for (const [message, mustEscalate] of cases) {
      const { engine, repository } = mkLlm();
      const c = await seedAdult(repository, "llm_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: message }] });
      expect(r.candidate.currentState === "HUMAN_INTERVENTION_REQUIRED", `"${message}" deberia escalar=${mustEscalate}`).toBe(
        mustEscalate
      );
    }
  });
});
