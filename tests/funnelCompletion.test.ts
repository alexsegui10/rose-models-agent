import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";

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

async function seed(repository: InMemoryCandidateRepository, state: CandidateState, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "funnel_case", profileVisibility: "PRIVATE" }),
      age: 24,
      isAdultConfirmed: true,
      currentState: state,
      automationPaused: true,
      manualControlActive: true,
      candidateClaimsFollowRequestAccepted: true,
      ...overrides
    })
  );
}

describe("Cierre del funnel: verificacion de perfil (PROFILE_READY_FOR_REVIEW)", () => {
  it("perfil encaja -> continua a QUALIFYING, reanuda y el bot retoma con una pregunta", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "PROFILE_READY_FOR_REVIEW");

    const result = await engine.applyProfileReviewDecision({ candidateId: seeded.id, fits: true });

    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.candidate.humanVerifiedProfileAccess).toBe(true);
    expect(result.candidate.humanProfileReviewStatus).toBe("POTENTIAL_FIT");
    expect(result.candidate.automationPaused).toBe(false);
    expect(result.candidate.manualControlActive).toBe(false);
    expect(result.proposedMessage).not.toBeNull();
    expect(result.proposedMessage!.includes("?")).toBe(true);

    const messages = await repository.listMessages(seeded.id);
    expect(messages.some((m) => m.role === "agent")).toBe(true);
  });

  it("perfil NO encaja -> REJECTED, marcado como no-fit, sin mensaje proactivo", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "PROFILE_READY_FOR_REVIEW");

    const result = await engine.applyProfileReviewDecision({ candidateId: seeded.id, fits: false });

    expect(result.candidate.currentState).toBe("REJECTED");
    expect(result.candidate.humanProfileReviewStatus).toBe("NOT_A_FIT");
    expect(result.proposedMessage).toBeNull();
  });

  it("tras verificar el perfil, la candidata ya NO se queda atascada (avanza la cualificacion)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "PROFILE_READY_FOR_REVIEW", { age: undefined, isAdultConfirmed: false });
    await engine.applyProfileReviewDecision({ candidateId: seeded.id, fits: true });

    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "me llamo ana y tengo 23"
    });

    expect(reply.candidate.currentState).not.toBe("PROFILE_READY_FOR_REVIEW");
    expect(reply.candidate.currentState).not.toBe("CLOSED");
    // No repite el opener de "aceptame la solicitud" (ya esta verificado).
    expect(reply.response.toLowerCase()).not.toContain("acepta");
  });

  it("verificar perfil desde un estado que no lo admite no rompe (no avanza)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");
    const result = await engine.applyProfileReviewDecision({ candidateId: seeded.id, fits: true });
    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.proposedMessage).toBeNull();
  });
});

describe("Cierre del funnel: confirmacion de llamada (-> CALL_SCHEDULED)", () => {
  it("confirmar la llamada desde COLLECTING_CALL_DETAILS pasa a CALL_SCHEDULED y confirma con la hora", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS", { phone: "612345678" });

    const result = await engine.confirmScheduledCall({ candidateId: seeded.id, slot: "el lunes a las 18h" });

    expect(result.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(result.candidate.scheduledCallSlot).toBe("el lunes a las 18h");
    expect(result.proposedMessage).not.toBeNull();
    expect(result.proposedMessage!.toLowerCase()).toContain("lunes");
    expect(result.proposedMessage!.toLowerCase()).toMatch(/llam|hablamos/);
  });

  it("confirmar sin hora concreta tambien cierra a CALL_SCHEDULED con un mensaje generico", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "READY_TO_SCHEDULE");

    const result = await engine.confirmScheduledCall({ candidateId: seeded.id });

    expect(result.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(result.proposedMessage).not.toBeNull();
  });

  it("confirmar desde un estado que no lo admite no rompe (no avanza)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "QUALIFYING");
    const result = await engine.confirmScheduledCall({ candidateId: seeded.id });
    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.proposedMessage).toBeNull();
  });

  it("confirmar la llamada NO saca de HUMAN_INTERVENTION_REQUIRED (invariante 4)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "HUMAN_INTERVENTION_REQUIRED");
    const result = await engine.confirmScheduledCall({ candidateId: seeded.id, slot: "el lunes" });
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.proposedMessage).toBeNull();
  });

  it("confirmar la llamada reanuda la automatizacion (no deja automationPaused, solo silencio por estado)", async () => {
    // El silencio en CALL_SCHEDULED es por ESTADO (isSilencedState), no por automationPaused: confirmar
    // NO debe dejar el flag de pausa puesto (eso se leeria como HIR/control manual). Asi, si la candidata
    // pide cambiar la llamada, el turno fluye y la escalada a Alex funciona (no queda muteada de raiz).
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS", { phone: "612345678" });
    const result = await engine.confirmScheduledCall({ candidateId: seeded.id, slot: "el lunes a las 18h" });
    expect(result.candidate.automationPaused).toBe(false);
    expect(result.candidate.manualControlActive).toBe(false);

    // Una peticion de cambio NO se silencia: se procesa y escala a Alex.
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "oye necesito cambiar la llamada a otro dia"
    });
    expect(reply.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(reply.candidate.notes.some((note) => note.startsWith("CALL_CHANGE_REQUEST"))).toBe(true);
  });

  it("en CALL_SCHEDULED un mensaje benigno NO recibe respuesta (bot silenciado, sin gasto de OpenAI)", async () => {
    // Cambio 19-jun: con la llamada ya agendada el bot de IG calla (CALL_SCHEDULED en isSilencedState).
    // El siguiente paso lo lleva la llamada de voz; un "vale, gracias" ya no genera respuesta ni coste.
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", {
      scheduledCallSlot: "el martes a las 17h",
      automationPaused: false,
      manualControlActive: false
    });

    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "vale perfecto, gracias"
    });

    expect(reply.response).toBe("");
    // El estado se mantiene: no se reabre el guion.
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
  });

  it("si la candidata pide cambiar/cancelar la llamada ya agendada, escala a Alex (no reconfirma)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "CALL_SCHEDULED", {
      scheduledCallSlot: "el martes a las 17h",
      automationPaused: false,
      manualControlActive: false
    });

    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "necesito cambiar la llamada al jueves, el martes no puedo"
    });

    expect(reply.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(reply.candidate.notes.some((note) => note.startsWith("CALL_CHANGE_REQUEST"))).toBe(true);
    // No reconfirma la hora vieja como si nada.
    expect(reply.response.toLowerCase()).not.toContain("todo listo, te llamo el martes");
  });

  it("un mensaje en REJECTED no recibe respuesta (bot silenciado, sin gasto de OpenAI)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "REJECTED", { automationPaused: false, manualControlActive: false });

    const first = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "por que no?"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "funnel_case",
      message: "porfa dame una oportunidad"
    });

    // Decision de Alex: una candidata rechazada deja de recibir respuestas (nada de 'Okeyy' degradado).
    expect(first.response).toBe("");
    expect(second.response).toBe("");
  });
});
