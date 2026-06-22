import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type DeviceEligibility } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// B (Alex 22-jun): aprobar el MOVIL (calidad iPhone 11) es una decision SEPARADA de aprobar el PERFIL.
// El bot solo avanza a la llamada cuando AMBAS estan aprobadas.

function setup() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
  return { engine, repository };
}

async function seedReview(
  repository: InMemoryCandidateRepository,
  deviceEligibility: DeviceEligibility,
  overrides: Record<string, unknown> = {}
) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `gate_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Carla",
      age: 40,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceType: "IPHONE",
      deviceModel: "iphone 11",
      deviceEligibility,
      currentState: "WAITING_HUMAN_REVIEW",
      automationPaused: true,
      ...overrides
    })
  );
}

describe("B: aprobacion de movil separada; el bot espera a AMBAS aprobaciones", () => {
  it("aprobar SOLO el perfil con movil pendiente -> NO avanza a la llamada (espera el movil)", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "PENDING_QUALITY_TEST");
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.candidate.humanFitDecision).toBe("APPROVED");
    expect(r.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(r.proposedMessage).toBeNull();
  });

  it("aprobar SOLO el movil con perfil pendiente -> NO avanza (espera el perfil)", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "PENDING_QUALITY_TEST");
    const r = await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: true });
    expect(r.candidate.deviceEligibility).toBe("APPROVED");
    expect(r.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(r.proposedMessage).toBeNull();
  });

  it("aprobar AMBAS (perfil y luego movil) -> avanza a la llamada y propone", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "PENDING_QUALITY_TEST");
    await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    const r = await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: true });
    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(r.candidate.deviceEligibility).toBe("APPROVED");
    expect(r.candidate.automationPaused).toBe(false);
    expect(r.proposedMessage ?? "").toMatch(/llamada/i);
  });

  it("aprobar AMBAS (movil y luego perfil) -> avanza igualmente", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "PENDING_QUALITY_TEST");
    await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: true });
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
  });

  it("movil OK desde el principio (iphone 13) + aprobar perfil -> avanza directo", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "APPROVED", { deviceModel: "iphone 13" });
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
  });

  it("rechazar el movil -> NOT_ELIGIBLE y no avanza", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository, "PENDING_QUALITY_TEST");
    const r = await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: false });
    expect(r.candidate.deviceEligibility).toBe("NOT_ELIGIBLE");
    expect(r.candidate.currentState).not.toBe("COLLECTING_CALL_DETAILS");
  });

  it("'Movil OK' desde HUMAN_INTERVENTION_REQUIRED NO reanuda (no se salta el incidente; invariante 4)", async () => {
    const { engine, repository } = setup();
    // Perfil ya aprobado pero hay un incidente abierto en HIR (p.ej. prompt-injection): aprobar el movil
    // NO debe sacarla de HIR de refilon; eso exige resolver el incidente con su decision designada.
    const c = await seedReview(repository, "PENDING_QUALITY_TEST", {
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      humanFitDecision: "APPROVED"
    });
    const r = await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: true });
    expect(r.candidate.deviceEligibility).toBe("APPROVED");
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(r.proposedMessage).toBeNull();
  });
});
