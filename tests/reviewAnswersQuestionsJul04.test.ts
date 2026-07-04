import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Re-sonda 4-jul (caso Fernanda): una pregunta de IDENTIDAD ("¿seria con mi nombre original?") estando
// ya en WAITING_HUMAN_REVIEW recibia el holding "lo comento con mi socio", ignorandola. Regla de Alex:
// SIEMPRE se contesta lo que pregunta y luego se reconduce. Ahora se responde con el conocimiento
// aprobado, SIN cambiar de estado y SIN filtrar cifras en una negociacion (invariantes 3 y 4).

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

async function seedInReview(repository: InMemoryCandidateRepository, overrides: Partial<Candidate> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `rev_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Fernanda",
      age: 42,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      currentState: "WAITING_HUMAN_REVIEW",
      ...overrides
    })
  );
}

describe("WAITING_HUMAN_REVIEW: se contesta la duda con cobertura (no solo %/contrato)", () => {
  it("'¿seria con mi nombre original?' -> responde identidad espanola, NO el holding del socio (caso Fernanda)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "O sea no seria con mi nombre original?"
    });
    expect(result.response.toLowerCase()).toContain("identidad");
    expect(result.response.toLowerCase()).not.toContain("comentar tu perfil con mi socio");
    // Sigue en revision: contesta pero NO reabre la cualificacion ni avanza (invariante 4).
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("una pregunta de PRIVACIDAD ('se puede bloquear mi pais?') tambien se responde en revision", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "y se puede bloquear mi pais para que no me vean?"
    });
    expect(result.response.toLowerCase()).toMatch(/pais|identidad|pinterest/);
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("INVARIANTE 3: una NEGOCIACION en revision ('quiero el 50, me lo mejorais?') NO libera cifra y NO se responde con 70/30", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "quiero el 50 para mi, me lo mejorais?"
    });
    expect(result.response).not.toMatch(/70%|30%/);
  });

  it("un acuse trivial en revision sigue sin reabrir nada (holding/silencio, sin regresion)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository, { instagramUsername: "ack_case" });
    // Primer turno deja el holding puesto (alreadyAwaitingPartner) y el segundo acuse cae en silencio.
    await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "bueno"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "ok"
    });
    expect(result.response.toLowerCase()).not.toContain("identidad");
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });
});
