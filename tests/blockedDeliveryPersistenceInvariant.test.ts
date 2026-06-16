import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Invariante de persistencia en entrega BLOQUEADA (conversationEngine.ts ~705-764).
// Cuando deliveryStatus === "BLOCKED" (porque el codigo escalo a revision humana, porque la
// validacion factual fallo, o porque ya estamos en HUMAN_INTERVENTION_REQUIRED) el motor hace
// algo DUAL a proposito:
//   - SI persiste el estado nuevo decidido por codigo y SI persiste las transiciones planificadas
//     (si no, el siguiente turno recargaria el estado previo y el bot seguiria cualificando como si
//     nada, rompiendo invariantes 1 y 4).
//   - NO persiste ningun mensaje del agente para ese turno (esta bloqueado: nada se "envia"), y la
//     respuesta no se entrega.
// Solo el modo AUTOMATIC produce deliveryStatus "SENT"/"BLOCKED"; en HUMAN_APPROVAL todo es
// "PENDING_APPROVAL" y en DRAFT_ONLY es "DRAFT_ONLY", asi que estos tests fijan el modo AUTOMATIC.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    automationMode: "AUTOMATIC"
  });

  return { engine, repository };
}

describe("Invariante de persistencia en entrega BLOQUEADA (AUTOMATIC)", () => {
  it("al escalar a HUMAN_INTERVENTION_REQUIRED persiste el estado avanzado y la transicion pero NO un mensaje de agente nuevo", async () => {
    const { engine, repository } = createEngine();

    // Primer turno: dato de edad valido. Se entrega con normalidad (SENT) y SI deja mensaje de agente.
    const first = await engine.handleIncomingMessage({
      instagramUsername: "blocked_hir_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 22 anos"
    });
    expect(first.deliveryStatus).toBe("SENT");
    const candidateId = first.candidate.id;

    const messagesAfterFirst = await repository.listMessages(candidateId);
    const agentMessagesAfterFirst = messagesAfterFirst.filter((message) => message.role === "agent");
    expect(agentMessagesAfterFirst.length).toBeGreaterThan(0);

    // Segundo turno: edad contradictoria -> el codigo escala a HUMAN_INTERVENTION_REQUIRED y bloquea.
    const second = await engine.handleIncomingMessage({
      candidateId,
      instagramUsername: "blocked_hir_case",
      message: "Tengo 25 anos"
    });

    expect(second.deliveryStatus).toBe("BLOCKED");
    expect(second.automationBlocked).toBe(true);
    expect(second.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");

    // El ESTADO nuevo se persiste: al releer el candidato del repositorio sigue escalado.
    const persistedCandidate = await repository.findCandidateById(candidateId);
    expect(persistedCandidate?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");

    // La TRANSICION a HUMAN_INTERVENTION_REQUIRED se persiste (no solo se planifica).
    const transitions = await repository.listTransitions(candidateId);
    expect(transitions.some((transition) => transition.toState === "HUMAN_INTERVENTION_REQUIRED")).toBe(true);
    expect(second.plannedTransitions.some((transition) => transition.toState === "HUMAN_INTERVENTION_REQUIRED")).toBe(true);

    // El MENSAJE de agente del turno bloqueado NO se persiste: sigue habiendo el/los mensajes de
    // agente del primer turno, ninguno nuevo por el turno bloqueado.
    const messagesAfterSecond = await repository.listMessages(candidateId);
    const agentMessagesAfterSecond = messagesAfterSecond.filter((message) => message.role === "agent");
    expect(agentMessagesAfterSecond).toHaveLength(agentMessagesAfterFirst.length);
  });

  it("al fallar la guarda factual / requerir revision humana (negociacion) bloquea sin persistir mensaje de agente", async () => {
    const { engine, repository } = createEngine();

    // Negociacion explicita de porcentaje -> requiere revision humana (invariante 3): BLOCKED.
    const result = await engine.handleIncomingMessage({
      instagramUsername: "blocked_factual_case",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% a mi?"
    });

    expect(result.deliveryStatus).toBe("BLOCKED");
    expect(result.automationBlocked).toBe(true);

    const candidateId = result.candidate.id;

    // No se entrega respuesta: ningun mensaje de agente queda persistido para este turno.
    const messages = await repository.listMessages(candidateId);
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(0);

    // Aun bloqueando el envio, el estado proyectado por codigo se persiste (no se pierde el avance).
    const persistedCandidate = await repository.findCandidateById(candidateId);
    expect(persistedCandidate).not.toBeNull();
    expect(persistedCandidate?.currentState).toBe(result.candidate.currentState);

    // Las transiciones planificadas (si las hubo) quedan reflejadas en el repositorio, nunca solo en
    // memoria del resultado.
    const transitions = await repository.listTransitions(candidateId);
    expect(transitions.map((transition) => transition.toState)).toEqual(
      result.plannedTransitions.map((transition) => transition.toState)
    );
  });
});
