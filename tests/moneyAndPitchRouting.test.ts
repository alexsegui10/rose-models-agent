import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones de la iteracion 1 (jueces): el pitch operativo nunca se entregaba, las preguntas
// de dinero respondibles se derivaban al socio y las demandas salariales acababan en "Okeyy.".

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

async function seededCandidate(repository: InMemoryCandidateRepository, overrides: Partial<Candidate> = {}): Promise<Candidate> {
  return repository.saveCandidate({
    ...createCandidate({ instagramUsername: overrides.instagramUsername ?? "lead_routing", profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING",
    firstName: "Carla",
    age: 27,
    isAdultConfirmed: true,
    ...overrides
  });
}

describe("deterministic extractor money routing", () => {
  it("flags a guaranteed-salary demand as commercial negotiation for human review", () => {
    const result = extractDeterministicUnderstanding("500 dolares por semana");
    expect(result.intent).toBe("ASKS_ABOUT_PERCENTAGE");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("flags 'quiero 800 garantizados al mes' as negotiation", () => {
    const result = extractDeterministicUnderstanding("quiero 800 garantizados al mes");
    expect(result.intent).toBe("ASKS_ABOUT_PERCENTAGE");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("routes payment-timing questions ('me pagan ahora o al mes?') as answerable money questions", () => {
    const result = extractDeterministicUnderstanding("Bien y me pagan algo ahora? O al mes?");
    expect(result.intent).toBe("ASKS_ABOUT_PERCENTAGE");
    expect(result.requiresHumanReview).toBe(false);
  });
});

describe("knowledge retrieval for the operational pitch", () => {
  it("retrieves the services entry for 'cual es su forma de trabajar?'", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: { ...createCandidate({ instagramUsername: "lead_pitch" }), currentState: "QUALIFYING" },
      intent: "REQUESTS_INFORMATION",
      question: "Cual es su forma de trabajar? Como promocionan a la modelo?"
    });
    expect(entries.map((entry) => entry.id)).toContain("services-agency-management");
  });

  it("retrieves commercial entries inside HUMAN_INTERVENTION_REQUIRED (la pausa frena decisiones, no respuestas)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: { ...createCandidate({ instagramUsername: "lead_hir_money" }), currentState: "HUMAN_INTERVENTION_REQUIRED" },
      intent: "ASKS_ABOUT_PERCENTAGE",
      question: "Trabajan con porcentaje o salario fijo?"
    });
    expect(entries.map((entry) => entry.id)).toContain("commercial-no-fixed-salary");
  });
});

describe("engine money and pitch behavior", () => {
  it("answers 'porcentaje o salario fijo?' with the canonical no-figure answer instead of the socio", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seededCandidate(repository);

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_routing",
      message: "Trabajan con porcentaje o salario fijo?"
    });

    expect(result.response.toLowerCase()).toContain("porcentaje");
    expect(result.response).not.toMatch(/\d{1,3}\s?%/);
    expect(result.response.toLowerCase()).not.toContain("socio");
  });

  it("keeps answering money questions inside HUMAN_INTERVENTION_REQUIRED", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seededCandidate(repository, {
      instagramUsername: "lead_routing_hir",
      currentState: "HUMAN_INTERVENTION_REQUIRED"
    });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_routing_hir",
      message: "Trabajan con porcentaje o salario fijo?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toContain("porcentaje");
    expect(result.response).not.toMatch(/\d{1,3}\s?%/);
  });

  it("escalates a guaranteed-salary demand instead of replying 'Okeyy'", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seededCandidate(repository, { instagramUsername: "lead_routing_demanda" });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_routing_demanda",
      message: "500 dolares por semana"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toContain("socio");
    expect(result.response).not.toMatch(/\d{1,3}\s?%/);
    expect(result.response.toLowerCase()).not.toMatch(/garantiz/);
  });

  it("delivers the operational pitch for 'cual es su forma de trabajar?' instead of deferring (replay-6 T11)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seededCandidate(repository, { instagramUsername: "lead_routing_pitch" });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_routing_pitch",
      message: "Cual es su forma de trabajar? Como promocionan a la modelo?"
    });

    expect(result.responsePlan.uncoveredQuestion).toBe(false);
    expect(result.response.toLowerCase()).toMatch(/trafico|contenido|estrategia/);
    expect(result.response.toLowerCase()).not.toContain("se lo consulto");
  });
});
