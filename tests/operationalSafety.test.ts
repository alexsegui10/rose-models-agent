import { describe, expect, it } from "vitest";
import { ConversationEngine, type ConversationEngineDependencies } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine(beforeSendCheck?: ConversationEngineDependencies["beforeSendCheck"]) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    beforeSendCheck
  });

  return { engine, repository };
}

describe("operational safety", () => {
  it("groups consecutive messages into one debounced turn", async () => {
    const { engine, repository } = createEngine();

    const result = await engine.handleIncomingTurn({
      instagramUsername: "debounce_case",
      profileVisibility: "PUBLIC",
      messages: [
        { content: "Tengo 23", externalMessageId: "debounce-1" },
        { content: "Soy de Madrid", externalMessageId: "debounce-2" },
        {
          content:
            "Tengo experiencia creando contenido, nunca he tenido OnlyFans, estoy disponible por las tardes y tengo iPhone 13",
          externalMessageId: "debounce-3"
        }
      ]
    });

    const messages = await repository.listMessages(result.candidate.id);
    expect(result.candidate.age).toBe(23);
    expect(result.candidate.city).toBe("Madrid");
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    // Los 3 mensajes de la candidata se guardan por separado (se ven como varias burbujas), pero el
    // turno es UNO: el bot responde una sola vez al contenido agrupado (no a cada fragmento).
    expect(messages.filter((message) => message.role === "candidate")).toHaveLength(3);
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(1);
  });

  it("ignores a duplicated externalMessageId without adding response or transition", async () => {
    const { engine, repository } = createEngine();

    const first = await engine.handleIncomingMessage({
      instagramUsername: "duplicate_case",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa",
      externalMessageId: "external-1"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "duplicate_case",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa",
      externalMessageId: "external-1"
    });

    const messages = await repository.listMessages(first.candidate.id);
    expect(second.duplicate).toBe(true);
    expect(messages.filter((message) => message.role === "candidate")).toHaveLength(1);
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(1);
  });

  it("does not send or transition when manual control becomes active before send", async () => {
    const { engine, repository } = createEngine(async (candidate) => ({
      ...candidate,
      manualControlActive: true,
      automationPaused: true
    }));

    const result = await engine.handleIncomingMessage({
      instagramUsername: "manual_case",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });

    const messages = await repository.listMessages(result.candidate.id);
    const transitions = await repository.listTransitions(result.candidate.id);
    expect(result.automationBlocked).toBe(true);
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(0);
    expect(transitions).toHaveLength(0);
  });

  it("bloqueo atomico: con control manual activo no persiste ni mensaje de agente ni transicion en la BD aunque el turno avanzaria de estado", async () => {
    // Sin bloqueo, este turno completo cualificaria y avanzaria a WAITING_HUMAN_REVIEW persistiendo
    // una transicion de estado y el mensaje del agente. Con control manual el bloqueo debe ser
    // ATOMICO: nada de lo que el motor habria escrito (mensaje + transicion) toca el repositorio.
    const { engine, repository } = createEngine(async (candidate) => ({
      ...candidate,
      manualControlActive: true,
      automationPaused: true
    }));

    const result = await engine.handleIncomingMessage({
      instagramUsername: "atomic_block_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 23, soy de Madrid, tengo experiencia y un iPhone 13, disponible por las tardes"
    });

    // Consultamos el REPOSITORIO directamente (no solo la salida del engine) para confirmar
    // que el bloqueo no dejo rastro persistido.
    const storedMessages = await repository.listMessages(result.candidate.id);
    const storedTransitions = await repository.listTransitions(result.candidate.id);

    expect(result.automationBlocked).toBe(true);
    expect(result.deliveryStatus).toBe("BLOCKED");
    expect(storedTransitions).toHaveLength(0);
    expect(storedMessages.filter((message) => message.role === "agent")).toHaveLength(0);
    // El mensaje entrante de la candidata SI se guarda (llego antes del punto de bloqueo de envio).
    expect(storedMessages.filter((message) => message.role === "candidate")).toHaveLength(1);
  });

  it("keeps a private profile in review-ready state when candidate says access was accepted but human has not verified it", async () => {
    const { engine } = createEngine();

    const first = await engine.handleIncomingMessage({
      instagramUsername: "profile_access_case",
      profileVisibility: "PRIVATE",
      message: "Hola"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "profile_access_case",
      message: "Ya os acepte la solicitud"
    });

    expect(second.candidate.currentState).toBe("PROFILE_READY_FOR_REVIEW");
    expect(second.candidate.candidateClaimsFollowRequestAccepted).toBe(true);
    expect(second.candidate.humanVerifiedProfileAccess).toBe(false);
    expect(second.candidate.humanProfileReviewStatus).toBe("NOT_REVIEWED");
  });

  it("escalates contradictory age data", async () => {
    const { engine } = createEngine();

    const first = await engine.handleIncomingMessage({
      instagramUsername: "age_conflict_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 22 anos"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "age_conflict_case",
      message: "Tengo 25 anos"
    });

    expect(second.candidate.age).toBe(22);
    expect(second.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(second.contradictions.some((item) => item.includes("age"))).toBe(true);
  });

  it("accepts a legitimate correction of age", async () => {
    const { engine } = createEngine();

    const first = await engine.handleIncomingMessage({
      instagramUsername: "age_correction_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 22 anos"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "age_correction_case",
      message: "Perdon, en realidad tengo 23 anos"
    });

    expect(second.candidate.age).toBe(23);
    expect(second.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(second.corrections.some((item) => item.includes("age"))).toBe(true);
  });
});
