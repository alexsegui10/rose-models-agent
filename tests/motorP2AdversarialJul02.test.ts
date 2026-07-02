import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Tests ADVERSARIALES de los P2 del motor autorizados para la noche de pre-lanzamiento (jul-2026):
// texto-02 (rechazo con llamada agendada), texto-03 (DECLINES sobre aprobada) y texto-05 (post-llamada).

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

async function seed(
  repository: InMemoryCandidateRepository,
  state: CandidateState,
  overrides: Partial<Candidate> = {}
): Promise<Candidate> {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `p2_${Math.random()}` }),
      currentState: state,
      firstName: "Carla",
      age: 24,
      isAdultConfirmed: true,
      phone: "+5491155554444",
      humanFitDecision: "APPROVED",
      ...overrides
    } as Candidate)
  );
}

async function turn(engine: ConversationEngine, candidate: Candidate, content: string) {
  return engine.handleIncomingMessage({
    instagramUsername: candidate.instagramUsername,
    message: content,
    externalMessageId: `m_${Math.random()}`
  });
}

describe("texto-02: rechazo/cancelación con la llamada AGENDADA desarma el auto-marcador y lo decide Alex", () => {
  const scheduledOverrides = { scheduledCallStartMs: Date.now() + 3_600_000, scheduledCallSlot: "mañana a las 18h" };

  it("'ya no me interesa, no quiero la llamada' en CALL_SCHEDULED -> NO se silencia, va a revisión humana", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", scheduledOverrides);
    await turn(engine, seeded, "ya no me interesa, no quiero la llamada");
    const after = await repository.findCandidateById(seeded.id);
    // Ya no CALL_SCHEDULED: el guard del dispatch (estado) deja de llamar. Lo decide Alex (HIR).
    expect(after?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("'cancelala porfa' (clítico argentino) en CALL_SCHEDULED -> tampoco se silencia", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", scheduledOverrides);
    const result = await turn(engine, seeded, "cancelala porfa");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    // RIESGO 2 del revisor: cancelar la llamada NO debe disparar el "no soy ningún bot" (el .includes("ia")
    // casaba "cambiar/cancelar la llamada"). El borrador para Alex debe ser coherente con cancelar.
    expect(result.response.toLowerCase()).not.toContain("no soy ningun bot");
    expect(result.response.toLowerCase()).not.toContain("no soy ningún bot");
  });

  it("SEGURIDAD (RIESGO 4): 'tengo 16' con la llamada agendada NO se silencia -> sale del auto-marcador (invariante 2)", async () => {
    const { engine, repository } = createEngine();
    // Con una adulta ya aprobada, "tengo 16" es una CONTRADICCIÓN -> se escala a Alex (HIR): igual de seguro,
    // porque deja de estar en CALL_SCHEDULED y el dispatch NO la llama. Lo clave: NO queda silenciada+agendada.
    const seeded = await seed(repository, "CALL_SCHEDULED", scheduledOverrides);
    await turn(engine, seeded, "espera que tengo 16 años");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).not.toBe("CALL_SCHEDULED");
    expect(["CLOSED", "HUMAN_INTERVENTION_REQUIRED"]).toContain(after?.currentState);
  });

  it("SEGURIDAD (RIESGO 4): menor SIN edad adulta previa -> CLOSED limpio (invariante 2)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", {
      ...scheduledOverrides,
      age: undefined,
      isAdultConfirmed: false
    });
    await turn(engine, seeded, "oye espera que tengo 16");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CLOSED");
  });

  it("charla NEUTRA en CALL_SCHEDULED sigue silenciada (no se gasta OpenAI ni se responde)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", scheduledOverrides);
    const result = await turn(engine, seeded, "jajaja vale genial");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CALL_SCHEDULED");
    expect(result.response).toBe("");
  });
});

describe("texto-03: DECLINES sobre una candidata APROBADA no cierra en terminal por su cuenta", () => {
  it("aprobada (COLLECTING) que dice 'no me interesa' -> HUMAN_INTERVENTION_REQUIRED (Alex decide), no CLOSED", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");
    await turn(engine, seeded, "no me interesa, dejalo");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("NO aprobada (QUALIFYING temprano) que rechaza -> CLOSED como siempre", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING", {
      humanFitDecision: "PENDING",
      phone: undefined,
      age: undefined,
      isAdultConfirmed: false
    });
    await turn(engine, seeded, "no me interesa, dejalo");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CLOSED");
  });

  it("ADVERSARIAL invariante 2: aprobada que rechaza Y declara ser menor -> CLOSED (la minoría gana)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");
    await turn(engine, seeded, "no me interesa, ademas tengo 16 años");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CLOSED");
  });

  it("ADVERSARIAL invariante 4: en HIR un 'no me interesa' NO la mueve (solo decide Alex)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "HUMAN_INTERVENTION_REQUIRED");
    await turn(engine, seeded, "no me interesa, dejalo");
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});

describe("texto-05: tras la llamada hecha (CALL_COMPLETED) el bot no promete 'agendar la llamada' otra vez", () => {
  it("'vale y ahora que?' tras la llamada -> NUNCA promete 'agendar la llamada' otra vez", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_COMPLETED");
    const result = await turn(engine, seeded, "vale genial y ahora que hacemos?");
    expect(result.response.trim().length).toBeGreaterThan(0);
    expect(result.response.toLowerCase()).not.toContain("agendar la llamada");
    expect(result.response.toLowerCase()).not.toContain("para la llamada");
  });

  it("acuse simple ('vale genial') tras la llamada -> tampoco re-agenda ni re-cualifica", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_COMPLETED");
    const result = await turn(engine, seeded, "vale genial");
    expect(result.response.toLowerCase()).not.toContain("agendar la llamada");
    expect(result.response.toLowerCase()).not.toContain("que edad tienes");
  });
});
