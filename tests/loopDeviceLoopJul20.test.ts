import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop iteracion 1 (barrido adversarial, caso Susana 49 confundida): con el movil marcado para revision, el
// bot repetia "Ese movil lo tendriamos que valorar bien" turno tras turno IGNORANDO todas sus preguntas (que es
// un chatter, la cara). Fix: el aviso del movil NO tapa lo que ella pregunta — si hay respuesta cubierta se
// RESPONDE; el aviso del movil solo sale cuando no hay nada cubierto que contestar.

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

async function seed(repository: InMemoryCandidateRepository, device: "PENDING_QUALITY_TEST" | "NOT_ELIGIBLE") {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({
        instagramUsername: "dev_" + device + "_" + Math.random().toString().slice(2, 6),
        profileVisibility: "PUBLIC"
      }),
      firstName: "Susana",
      age: 45,
      isAdultConfirmed: true,
      deviceEligibility: device,
      currentState: "HUMAN_INTERVENTION_REQUIRED" as CandidateState
    } as unknown as Candidate)
  );
}

const isDeviceHolding = (r: string) => /valorar bien|con ese movil no podemos|lamentablemente con ese movil/i.test(r);

describe("Movil en revision: el aviso NO tapa las preguntas cubiertas (fix del loop de Susana)", () => {
  it("PENDING_QUALITY_TEST: 'que es un chatter?' se RESPONDE (glosario), no el aviso del movil", async () => {
    const { engine, repository } = mk();
    const c = await seed(repository, "PENDING_QUALITY_TEST");
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "che y que es un chatter?" }]
    });
    expect(r.response.toLowerCase()).toContain("chatea");
    expect(isDeviceHolding(r.response)).toBe(false);
  });

  it("PENDING_QUALITY_TEST: 'tengo que mostrar la cara?' se responde con la ficha de la cara, no el aviso del movil", async () => {
    const { engine, repository } = mk();
    const c = await seed(repository, "PENDING_QUALITY_TEST");
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo que mostrar la cara si o si?" }]
    });
    expect(r.response.toLowerCase()).toContain("cara");
    expect(isDeviceHolding(r.response)).toBe(false);
  });

  it("NOT_ELIGIBLE: una pregunta CUBIERTA se responde en vez de repetir el rechazo del movil", async () => {
    const { engine, repository } = mk();
    const c = await seed(repository, "NOT_ELIGIBLE");
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "che como es el tema del trafico?" }]
    });
    expect(r.response.trim().length).toBeGreaterThan(20);
    expect(isDeviceHolding(r.response)).toBe(false);
  });

  it("PENDING_QUALITY_TEST: si NO hay nada cubierto que responder, el aviso del movil SÍ sale (no se pierde el gate)", async () => {
    const { engine, repository } = mk();
    const c = await seed(repository, "PENDING_QUALITY_TEST");
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "buenas, todo bien?" }]
    });
    expect(isDeviceHolding(r.response)).toBe(true);
  });
});
