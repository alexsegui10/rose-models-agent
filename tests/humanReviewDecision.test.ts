import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

async function seedCandidate(
  repository: InMemoryCandidateRepository,
  state: CandidateState,
  overrides: Record<string, unknown> = {}
) {
  const base = createCandidate({ instagramUsername: "review_case", profileVisibility: "PUBLIC" });
  const candidate = normalizeCandidate({
    ...base,
    age: 24,
    isAdultConfirmed: true,
    currentState: state,
    humanReviewStatus: "PENDING",
    automationPaused: true,
    manualControlActive: true,
    ...overrides
  });
  return repository.saveCandidate(candidate);
}

describe("Decision humana + propuesta de llamada (peticion de Alex #3/#5)", () => {
  it("al APROBAR desde WAITING_HUMAN_REVIEW, el bot propone una llamada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedCandidate(repository, "WAITING_HUMAN_REVIEW");

    const result = await engine.applyHumanDecision({ candidateId: seeded.id, decision: "APPROVE" });

    expect(result.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(result.proposedMessage).not.toBeNull();
    expect(result.proposedMessage!.toLowerCase()).toContain("llamada");
    // Propone concretar el momento (dia/hora).
    expect(result.proposedMessage!.toLowerCase()).toMatch(/dia|hora|cuando/);

    // El mensaje proactivo queda persistido como mensaje del agente.
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((message) => message.role === "agent" && message.content.toLowerCase().includes("llamada"))).toBe(true);

    // Al aprobar se reanuda la automatizacion para que el bot siga el agendado.
    expect(result.candidate.automationPaused).toBe(false);
    expect(result.candidate.manualControlActive).toBe(false);
    expect(result.candidate.humanFitDecision).toBe("APPROVED");
  });

  it("al APROBAR desde HUMAN_INTERVENTION_REQUIRED tambien propone llamada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedCandidate(repository, "HUMAN_INTERVENTION_REQUIRED");

    const result = await engine.applyHumanDecision({ candidateId: seeded.id, decision: "APPROVE" });

    expect(result.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(result.proposedMessage!.toLowerCase()).toContain("llamada");
  });

  it("al RECHAZAR pasa a REJECTED y NO propone llamada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedCandidate(repository, "WAITING_HUMAN_REVIEW");

    const result = await engine.applyHumanDecision({ candidateId: seeded.id, decision: "REJECT", note: "No encaja" });

    expect(result.candidate.currentState).toBe("REJECTED");
    expect(result.proposedMessage).toBeNull();
    expect(result.candidate.humanFitDecision).toBe("REJECTED");
  });

  it("aprobar desde un estado que no admite la transicion no rompe (no avanza)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedCandidate(repository, "QUALIFYING");

    const result = await engine.applyHumanDecision({ candidateId: seeded.id, decision: "APPROVE" });

    // No se fuerza una transicion invalida: la candidata sigue donde estaba y no hay propuesta.
    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.proposedMessage).toBeNull();
  });

  it("registra las transiciones de la decision", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedCandidate(repository, "WAITING_HUMAN_REVIEW");

    await engine.applyHumanDecision({ candidateId: seeded.id, decision: "APPROVE" });

    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.some((transition) => transition.toState === "APPROVED")).toBe(true);
    expect(transitions.some((transition) => transition.toState === "COLLECTING_CALL_DETAILS")).toBe(true);
  });
});
