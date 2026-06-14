import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { buildConsistentCandidatePatch } from "@/application/dataConsistency";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate } from "@/domain/candidate";

// Regresiones de la auditoria de codigo del motor (jun-2026). Cada test fallaba antes del fix y
// cubre un escenario que los 405 tests previos no tocaban.

function createEngine(automationMode?: "DRAFT_ONLY" | "HUMAN_APPROVAL" | "AUTOMATIC") {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    automationMode
  });
  return { engine, repository };
}

describe("audit: una entrega BLOCKED en AUTOMATIC debe persistir la transicion de estado", () => {
  it("guarda la pausa a HUMAN_INTERVENTION_REQUIRED aunque el mensaje quede bloqueado", async () => {
    const { engine, repository } = createEngine("AUTOMATIC");
    const result = await engine.handleIncomingMessage({
      instagramUsername: "blocked_persists_state",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% a mi?"
    });

    // El borrador no se envia (negociacion -> revision humana), pero la pausa SI debe quedar guardada:
    // si no, el siguiente turno recarga el estado viejo y el bot seguiria cualificando (invariantes 1 y 4).
    expect(result.deliveryStatus).toBe("BLOCKED");
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");

    const stored = await repository.findCandidateById(result.candidate.id);
    expect(stored?.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");

    const transitions = await repository.listTransitions(result.candidate.id);
    expect(transitions.some((transition) => transition.toState === "HUMAN_INTERVENTION_REQUIRED")).toBe(true);
  });
});

describe("audit: la escalada por contradiccion de datos queda etiquetada", () => {
  it("asigna humanReviewReason DATA_CONTRADICTION cuando la edad cambia sin correccion", async () => {
    const { engine } = createEngine("HUMAN_APPROVAL");
    const first = await engine.handleIncomingMessage({
      instagramUsername: "contradiction_label",
      profileVisibility: "PUBLIC",
      message: "Tengo 25 anos"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "contradiction_label",
      message: "Tengo 35 anos"
    });

    expect(second.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(second.candidate.humanReviewReason).toBe("DATA_CONTRADICTION");
  });
});

describe("audit: marcadores vacios del LLM (':') no rellenan campos de texto libre", () => {
  it("ignora firstName/experienceDescription/goals sin sentido para no saltarse los slots de nombre y OF", () => {
    const candidate = createCandidate({ instagramUsername: "junk_fields" });
    const result = buildConsistentCandidatePatch({
      candidate,
      extractedData: { firstName: ":", experienceDescription: ":", goals: "-" },
      inboundMessage: "hola me interesa"
    });
    expect(result.patch.firstName).toBeUndefined();
    expect(result.patch.experienceDescription).toBeUndefined();
    expect(result.patch.goals).toBeUndefined();
  });
});

describe("audit: un movil NOT_ELIGIBLE no se puede re-aprobar en silencio", () => {
  it("escala en vez de actualizar en blando NOT_ELIGIBLE -> APPROVED", () => {
    const candidate = {
      ...createCandidate({ instagramUsername: "device_floor" }),
      deviceEligibility: "NOT_ELIGIBLE" as const
    };
    const result = buildConsistentCandidatePatch({
      candidate,
      extractedData: { deviceEligibility: "APPROVED" },
      inboundMessage: "Me acabo de comprar un iPhone 14"
    });

    // Un rechazo duro por hardware requiere verificacion humana real, nunca auto-aprobarse por texto.
    expect(result.patch.deviceEligibility).toBeUndefined();
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.corrections).toHaveLength(0);
  });
});
