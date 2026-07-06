import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// REGLA DE ALEX (5/6-jul): las plantillas están bien SOLO en su momento. La explicación del socio al
// ENTRAR en revisión (tras acabar la cualificación) se queda — es su momento. El "Sin prisa..." se
// ELIMINÓ (pisaba preguntas). Y tras decir lo del socio: PAUSA TOTAL (decisión explícita de Alex 6-jul,
// ahorro de tokens) — visto a TODO hasta su Encaja; el reproceso del Encaja lee y contesta lo escrito.

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

async function seedInReview(repository: InMemoryCandidateRepository) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `tt_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 34,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      currentState: "WAITING_HUMAN_REVIEW"
    })
  );
}

// Deja dicha la explicación del socio (alreadyAwaitingPartner) con un primer turno neutro.
async function seedAwaiting(engine: ConversationEngine, repository: InMemoryCandidateRepository) {
  const seeded = await seedInReview(repository);
  await engine.handleIncomingMessage({
    candidateId: seeded.id,
    instagramUsername: seeded.instagramUsername,
    message: "entendido"
  });
  return seeded;
}

describe("PAUSA TOTAL tras el socio (Alex 6-jul): visto a todo hasta el Encaja", () => {
  it("preguntas, datos, despedidas y acuses -> TODO en visto ('' y nada de 'Sin prisa')", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedAwaiting(engine, repository);
    for (const msg of [
      "y tengo que pagar algo para empezar?",
      "soy de madrid",
      "pues mañana a las 6",
      "chau, saludos",
      "ok",
      "?",
      "me podeis llamar?"
    ]) {
      const result = await engine.handleIncomingMessage({
        candidateId: seeded.id,
        instagramUsername: seeded.instagramUsername,
        message: msg
      });
      expect(result.response.trim(), `"${msg}" debia quedar en visto`).toBe("");
      expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    }
  });

  it("la pausa NO traga una escalada de seguridad: declarar minoria en revision sigue escalando", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedAwaiting(engine, repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "bueno la verdad tengo 16"
    });
    expect(["HUMAN_INTERVENTION_REQUIRED", "CLOSED"]).toContain(result.candidate.currentState);
  });
});

describe("las plantillas en SU momento siguen intactas", () => {
  it("al ENTRAR en revisión (primer turno) la explicación del socio SÍ sale", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "vale entendido"
    });
    expect(result.response.toLowerCase()).toContain("socio");
  });

  it("INVARIANTE 4: pedir la llamada YA sin Encaja difiere o escala, jamás propone día/hora", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "podemos hacer la llamada ya?"
    });
    // Exigir la llamada inmediata puede escalar a Alex (lead caliente = su decisión); lo INNEGOCIABLE
    // es que nada proponga ni confirme agenda sin su Encaja.
    expect(["WAITING_HUMAN_REVIEW", "HUMAN_INTERVENTION_REQUIRED"]).toContain(result.candidate.currentState);
    expect(result.response.toLowerCase()).not.toContain("agendada");
    expect(result.response.toLowerCase()).not.toContain("que dia y");
    expect(result.response.toLowerCase()).not.toContain("te la dejo apuntada");
  });

  it("REGRESIÓN (revisor 5-jul): '¿me podéis llamar?' pre-socio NO recibe el plan de llamada por el self-check", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "me podeis llamar?"
    });
    expect(result.response.toLowerCase()).not.toContain("agendamos");
    expect(result.response.toLowerCase()).not.toContain("dia y una hora");
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("INVARIANTE 3: negociación en revisión sigue sin cifra", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedInReview(repository);
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "quiero el 50 para mi, me lo mejorais?"
    });
    expect(result.response).not.toMatch(/70%|30%/);
  });
});
