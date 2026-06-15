import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import type { ConversationUnderstandingProvider, ModelConversationOutput } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Cuenta cuantas veces se invoca la comprension (proxy de "se llamo a OpenAI"): el ahorro de tokens
// de Alex exige que una candidata silenciada NO dispare ninguna llamada al modelo.
class CountingUnderstandingProvider implements ConversationUnderstandingProvider {
  calls = 0;
  private readonly inner = new DeterministicUnderstandingProvider();
  async understand(input: Parameters<ConversationUnderstandingProvider["understand"]>[0]): Promise<ModelConversationOutput> {
    this.calls += 1;
    return this.inner.understand(input);
  }
}

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const understandingProvider = new CountingUnderstandingProvider();
  const engine = new ConversationEngine({ repository, understandingProvider, automationMode: "AUTOMATIC" });
  return { engine, repository, understandingProvider };
}

async function seed(repository: InMemoryCandidateRepository, currentState: CandidateState) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "silenced_case", profileVisibility: "PUBLIC" }),
      age: 24,
      isAdultConfirmed: true,
      currentState
    })
  );
}

describe("Rechazo humano y silencio del bot (ahorro de OpenAI)", () => {
  it("rechazar desde QUALIFYING deja REJECTED y silencia el bot sin llamar al modelo", async () => {
    const { engine, repository, understandingProvider } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");

    const rejected = await engine.rejectCandidate({ candidateId: seeded.id, note: "no encaja" });
    expect(rejected.candidate.currentState).toBe("REJECTED");
    expect(rejected.candidate.humanFitDecision).toBe("REJECTED");
    expect(rejected.transitions).toHaveLength(1);

    understandingProvider.calls = 0;
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "silenced_case",
      message: "porfa dame una oportunidad"
    });

    expect(reply.response).toBe("");
    expect(reply.deliveryStatus).not.toBe("SENT");
    // Lo esencial: no se gasto OpenAI en una candidata rechazada.
    expect(understandingProvider.calls).toBe(0);
    // El mensaje entrante SI se guarda para el historial, aunque no se responda.
    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.role === "candidate" && m.content.includes("oportunidad"))).toBe(true);
  });

  it("se puede rechazar desde cualquier estado activo (p. ej. CALL_SCHEDULED)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED");
    const rejected = await engine.rejectCandidate({ candidateId: seeded.id });
    expect(rejected.candidate.currentState).toBe("REJECTED");
  });

  it("rechazar es idempotente: sobre una ya rechazada no hace nada", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "REJECTED");
    const rejected = await engine.rejectCandidate({ candidateId: seeded.id });
    expect(rejected.candidate.currentState).toBe("REJECTED");
    expect(rejected.transitions).toHaveLength(0);
  });
});

describe("Dar OK al perfil en cualquier momento", () => {
  it("en QUALIFYING marca POTENTIAL_FIT sin cambiar de estado ni proponer mensaje", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");
    const ok = await engine.markProfileOk({ candidateId: seeded.id });
    expect(ok.candidate.currentState).toBe("QUALIFYING");
    expect(ok.candidate.humanProfileReviewStatus).toBe("POTENTIAL_FIT");
    expect(ok.proposedMessage).toBeNull();
    expect(ok.transitions).toHaveLength(0);
  });

  it("en PROFILE_READY_FOR_REVIEW se comporta como la verificacion de perfil (avanza a QUALIFYING)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "PROFILE_READY_FOR_REVIEW");
    const ok = await engine.markProfileOk({ candidateId: seeded.id });
    expect(ok.candidate.currentState).toBe("QUALIFYING");
    expect(ok.candidate.humanProfileReviewStatus).toBe("POTENTIAL_FIT");
    expect(ok.proposedMessage).not.toBeNull();
  });
});
