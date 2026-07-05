import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Batch de la re-sonda (workflow deep-reanalysis, 5-jul): mejoras deterministas y SEGURAS extraidas de
// los hallazgos recurrentes de las 26 conversaciones reales. Interes de leads enganchados + gratitud sin
// non-sequitur.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

describe("interes: un lead enganchado ya no queda en UNKNOWN en el CRM", () => {
  it("responder el nombre sube el interes a al menos LOW (deja de ser UNKNOWN)", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "eng1",
      profileVisibility: "PUBLIC",
      message: "Hola quiero mas informacion"
    });
    const named = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "eng1",
      profileVisibility: "PUBLIC",
      message: "Lucia"
    });
    expect(named.candidate.interestLevel).not.toBe("UNKNOWN");
  });

  it("preguntar por el reparto (deal) sube a MEDIUM", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "eng2", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING",
        interestLevel: "UNKNOWN"
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "eng2",
      message: "cual es el porcentaje que me llevo yo?"
    });
    expect(["MEDIUM", "HIGH"]).toContain(result.candidate.interestLevel);
  });

  it("dar el telefono sigue subiendo a HIGH (sin regresion)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "eng3", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        humanFitDecision: "APPROVED",
        deviceEligibility: "APPROVED",
        currentState: "COLLECTING_CALL_DETAILS",
        interestLevel: "UNKNOWN"
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "eng3",
      message: "mi numero es +54 9 11 5352 8311"
    });
    expect(result.candidate.interestLevel).toBe("HIGH");
  });

  it("DECLINES sigue bajando a LOW (sin regresion)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "eng4", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING",
        interestLevel: "MEDIUM"
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "eng4",
      message: "no me interesa gracias"
    });
    expect(result.candidate.interestLevel).toBe("LOW");
  });

  it("con CONTROL MANUAL de Alex el interes NO se toca", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "eng5", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING",
        interestLevel: "UNKNOWN",
        manualControlActive: true
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "eng5",
      message: "si claro me interesa mucho"
    });
    expect(result.candidate.interestLevel).toBe("UNKNOWN");
  });
});

describe("gratitud sin non-sequitur en revision", () => {
  async function seedReview(repository: InMemoryCandidateRepository) {
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `g_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Lourdes",
        age: 31,
        isAdultConfirmed: true,
        currentState: "WAITING_HUMAN_REVIEW"
      })
    );
  }

  it("un turno con dato (telefono) NO recibe 'gracias por explicarmelo' (era un non-sequitur)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "si mi numero es +54 9 11 5352 8311"
    });
    expect(result.response.toLowerCase()).not.toContain("explicarmelo");
  });
});
