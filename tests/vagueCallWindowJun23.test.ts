import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decision de Alex: ante una FRANJA VAGA ("mañana por la tarde") el bot INSISTE en una hora concreta UNA vez;
// si la candidata vuelve a dar una franja, se ACEPTA y se la llama en esa franja (-> READY_TO_SCHEDULE).
// Bug (prueba E2E 23-jun): la propuesta inicial de la llamada ("¿que dia y a que hora te viene mejor?") hacia
// match con el detector de "ya pedi la hora", asi que el bot ACEPTABA la franja a la primera sin insistir.

function createEngine() {
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

async function approvedCollectingWithProposal(repository: InMemoryCandidateRepository, engine: ConversationEngine) {
  // Candidata lista para revision: al aprobar pasa a COLLECTING_CALL_DETAILS y se anade el mensaje de
  // PROPUESTA de llamada ("¿que dia y a que hora te viene mejor?") al historial (el que contaminaba el detector).
  const seeded = await repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "vague_case", profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 24,
      isAdultConfirmed: true,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      hasOnlyFans: false,
      currentState: "WAITING_HUMAN_REVIEW" as CandidateState
    })
  );
  const approved = await engine.applyHumanDecision({ candidateId: seeded.id, decision: "APPROVE" });
  expect(approved.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
  // El mensaje de propuesta debe estar en el historial y mencionar "a que hora" (la causa del bug).
  return seeded.id;
}

describe("Franja de llamada vaga: insistir en la hora UNA vez (Alex 23-jun)", () => {
  it("ante una franja vaga, el bot PIDE la hora concreta (no la acepta a la primera pese a la propuesta inicial)", async () => {
    const { engine, repository } = createEngine();
    const id = await approvedCollectingWithProposal(repository, engine);

    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: "vague_case", message: "mi numero es 612345678" });
    const vague = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "vague_case",
      message: "mañana por la tarde"
    });

    // Insiste en la hora concreta una vez (y NO auto-agenda una franja vaga como si fuera una cita).
    expect(vague.response.toLowerCase()).toMatch(/sobre que hora|a que hora te viene|que hora te viene/);
    expect(vague.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("si la candidata INSISTE con una franja, se ACEPTA y pasa a READY_TO_SCHEDULE (la llamamos en esa franja)", async () => {
    const { engine, repository } = createEngine();
    const id = await approvedCollectingWithProposal(repository, engine);

    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: "vague_case", message: "mi numero es 612345678" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: "vague_case", message: "mañana por la tarde" });
    const second = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "vague_case",
      message: "uff cualquier hora de la tarde, cuando puedas"
    });

    expect(second.candidate.currentState).toBe("READY_TO_SCHEDULE");
  });
});
