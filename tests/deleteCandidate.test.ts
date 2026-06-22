import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Borrado por-candidata (para reiniciar pruebas E2E desde cero). deleteCandidate ya existe en el
// repositorio; estos tests fijan el comportamiento del que depende el boton "Borrar / empezar de cero".

function createEngine(repository: InMemoryCandidateRepository) {
  return new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
}

describe("deleteCandidate: borra la candidata y TODO su historial", () => {
  it("borra candidata + mensajes + transiciones + decision de negociacion", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = createEngine(repository);
    const { candidate } = await engine.handleIncomingMessage({
      instagramUsername: "17841400000000001",
      profileVisibility: "PUBLIC",
      message: "hola me interesa"
    });
    await engine.handleIncomingMessage({
      candidateId: candidate.id,
      instagramUsername: candidate.instagramUsername,
      message: "me llamo ana"
    });
    // Decision de negociacion guardada (otro slot que tambien debe irse al borrar).
    await repository.saveNegotiationDecision({
      candidateId: candidate.id,
      requestedModelPercentage: 40,
      currentPolicyAgencyPercentage: 70,
      currentPolicyModelPercentage: 30,
      decision: "ALLOW_CUSTOM_TERMS",
      approvedAgencyPercentage: 60,
      approvedModelPercentage: 40,
      reason: "test",
      decidedBy: "alex",
      decidedAt: new Date()
    });

    expect(await repository.findCandidateById(candidate.id)).not.toBeNull();
    expect((await repository.listMessages(candidate.id)).length).toBeGreaterThan(0);
    expect((await repository.listTransitions(candidate.id)).length).toBeGreaterThan(0);
    expect(await repository.findApprovedNegotiationDecision(candidate.id)).not.toBeNull();

    await repository.deleteCandidate(candidate.id);

    expect(await repository.findCandidateById(candidate.id)).toBeNull();
    expect(await repository.listMessages(candidate.id)).toEqual([]);
    expect(await repository.listTransitions(candidate.id)).toEqual([]);
    expect(await repository.findApprovedNegotiationDecision(candidate.id)).toBeNull();
  });

  it("no afecta a otras candidatas", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = createEngine(repository);
    const a = (
      await engine.handleIncomingMessage({ instagramUsername: "17841400000000002", profileVisibility: "PUBLIC", message: "hola" })
    ).candidate;
    const b = (
      await engine.handleIncomingMessage({ instagramUsername: "17841400000000003", profileVisibility: "PUBLIC", message: "hola" })
    ).candidate;

    await repository.deleteCandidate(a.id);

    expect(await repository.findCandidateById(a.id)).toBeNull();
    expect(await repository.findCandidateById(b.id)).not.toBeNull();
    expect((await repository.listMessages(b.id)).length).toBeGreaterThan(0);
  });

  it("tras borrar, un re-test desde la MISMA cuenta de Instagram arranca de cero", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = createEngine(repository);
    const username = "17841400000000004";
    const first = (
      await engine.handleIncomingMessage({ instagramUsername: username, profileVisibility: "PUBLIC", message: "hola" })
    ).candidate;
    await engine.handleIncomingMessage({ candidateId: first.id, instagramUsername: username, message: "me llamo ana" });

    await repository.deleteCandidate(first.id);
    expect(await repository.findCandidateByInstagram(username)).toBeNull();

    // Un mensaje nuevo desde la misma cuenta crea una candidata NUEVA, sin el historial del run anterior.
    const second = (
      await engine.handleIncomingMessage({ instagramUsername: username, profileVisibility: "PUBLIC", message: "hola otra vez" })
    ).candidate;
    expect(second.id).not.toBe(first.id);
    expect(await repository.listMessages(first.id)).toEqual([]);
    expect((await repository.listMessages(second.id)).every((message) => message.candidateId === second.id)).toBe(true);
  });

  it("es idempotente: borrar una candidata inexistente no lanza", async () => {
    const repository = new InMemoryCandidateRepository();
    await expect(repository.deleteCandidate("no-existe")).resolves.toBeUndefined();
  });
});
