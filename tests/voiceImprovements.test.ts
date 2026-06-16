import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

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

async function seed(repository: InMemoryCandidateRepository, currentState: CandidateState, extra = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "voice_case", profileVisibility: "PUBLIC" }),
      currentState,
      ...extra
    })
  );
}

describe("Voz: tiempo de dedicacion (media jornada) SOLO si pregunta", () => {
  it("responde 'unas horas al dia / compaginar' cuando pregunta, sin escalar", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING", { firstName: "Ana", age: 26, isAdultConfirmed: true });
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "voice_case",
      message: "tengo otro trabajo, esto se puede a media jornada?"
    });
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toMatch(/horas al dia|compaginar|jornada completa/);
  });
});

describe("Voz: respeta la pausa ('dejame pensarlo')", () => {
  it("no empuja otra pregunta y responde con calidez, sin cerrar", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING", { firstName: "Marta", age: 28, isAdultConfirmed: true });
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "voice_case",
      message: "uff dejame pensarlo unos dias y te digo"
    });
    expect(result.candidate.currentState).not.toBe("CLOSED");
    expect(result.response.toLowerCase()).toContain("sin prisa");
    // No empuja una pregunta de cualificacion en el turno de pausa.
    expect(result.response.toLowerCase()).not.toContain("que edad tienes");
    expect(result.response.toLowerCase()).not.toContain("que movil tienes");
  });

  // Seguridad (invariante 2): la pausa JAMAS debe ganarle al cierre de menor. Aunque la frase de pausa
  // matchee, una menor pasa a CLOSED y nunca recibe el "sin prisa" (la pausa solo aplica en estados de
  // cualificacion activa, y el cierre por edad ocurre antes en decideNextState).
  it("una menor que pide pausar igualmente se cierra (CLOSED), nunca 'sin prisa'", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "voice_minor",
      profileVisibility: "PUBLIC",
      message: "tengo 16, dejame pensarlo unos dias y te digo"
    });
    expect(result.candidate.currentState).toBe("CLOSED");
    expect(result.response.toLowerCase()).not.toContain("sin prisa");
  });
});

describe("Voz: puente al retomar el guion tras responder una duda", () => {
  it("tras responder lo del pago enlaza con un puente a la pregunta pendiente", async () => {
    const { engine, repository } = createEngine();
    // Sin nombre todavia: la pregunta pendiente es el nombre.
    const seeded = await seed(repository, "QUALIFYING");
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "voice_case",
      message: "oye y esto es un sueldo fijo o porcentaje?"
    });
    expect(result.response.toLowerCase()).toContain("porcentaje");
    expect(result.response.toLowerCase()).toContain("volviendo a lo de antes");
    expect(result.response.toLowerCase()).toContain("como te llamas");
  });
});
