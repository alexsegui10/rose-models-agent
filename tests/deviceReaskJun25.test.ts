import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug Alex 25-jun: el bot pregunto "que movil tienes?", ella DIVIRTIO preguntando el pago (no dio movil), y el
// bot salto a "que modelo de movil tienes exactamente? marca y modelo" -> raro, da por hecho que ya dio un movil.
// FIX: si divirtio con una pregunta y aun no dio aparato, se RE-pregunta el movil SUAVE (no "marca y modelo").

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

async function seedAskedDevice(repository: InMemoryCandidateRepository) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "reask_" + Math.random().toString().slice(2, 6), profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      hasOnlyFans: undefined,
      deviceType: "UNKNOWN",
      deviceModel: null,
      deviceEligibility: "UNKNOWN",
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Re-pregunta del movil suave cuando divierte preguntando (Alex 25-jun)", () => {
  it("tras preguntar el movil, si ella pregunta el PAGO (no da movil), se RE-pregunta el movil suave, no 'marca y modelo'", async () => {
    const { engine, repository } = mk();
    const c = await seedAskedDevice(repository);
    // Turno 1: se pregunta el movil.
    const r1 = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "vale" }] });
    expect(r1.response.toLowerCase()).toContain("que movil tienes");
    // Turno 2: divierte preguntando el pago -> re-pregunta el movil SUAVE, NO "marca y modelo exactamente".
    const r2 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "y cuanto me vais a pagar?" }]
    });
    expect(r2.response.toLowerCase()).toContain("que movil tienes");
    expect(r2.response.toLowerCase()).not.toMatch(/marca y (?:el )?modelo|modelo de movil tienes exactamente/);
  });

  it("si NO divierte (vago/ack sin pregunta) tras preguntar el movil, SI escala al modelo exacto (rompe el dead-end)", async () => {
    const { engine, repository } = mk();
    const c = await seedAskedDevice(repository);
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "vale" }] });
    // No pregunta nada, solo un vago sin nombrar el aparato -> se pide el modelo exacto (luego PENDING + avanza).
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "esta bien, hago buenas fotos" }]
    });
    expect(r.response.toLowerCase()).toMatch(/marca y (?:el )?modelo|modelo de movil tienes exactamente/);
  });

  it("si DIVIERTE preguntando en cada turno sin dar movil, hay TOPE: acaba escalando (no re-pregunta en bucle)", async () => {
    const { engine, repository } = mk();
    const c = await seedAskedDevice(repository);
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "vale" }] });
    const diversions = ["y cuanto me vais a pagar?", "y que hace la agencia?", "y como son los pagos?", "y cada cuanto pagais?"];
    let escalated = false;
    for (const d of diversions) {
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: d }] });
      if (/marca y (?:el )?modelo|modelo de movil tienes exactamente/.test(r.response.toLowerCase())) escalated = true;
      if (r.candidate.deviceEligibility !== "UNKNOWN") escalated = true; // o ya marco PENDING y avanzo
    }
    expect(escalated).toBe(true);
  });
});
