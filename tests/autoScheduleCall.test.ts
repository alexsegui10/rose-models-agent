import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { parseProposedCallTime } from "@/application/callScheduling";

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
      ...createCandidate({ instagramUsername: `auto_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 24,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      humanFitDecision: "APPROVED",
      humanProfileReviewStatus: "POTENTIAL_FIT",
      phone: "612345678",
      currentState: state,
      automationPaused: false,
      manualControlActive: false,
      ...overrides
    })
  );
}

describe("auto-agendado de la llamada (determinista, dentro del turno)", () => {
  it("hueco libre + fit aprobado -> CALL_SCHEDULED con scheduledCallStartMs fijado", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");

    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "vale, manana a las 18 me viene genial"
    });

    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(reply.candidate.scheduledCallStartMs).toBeTypeOf("number");
    expect(reply.candidate.scheduledCallSlot).toBeTruthy();
    expect(reply.response.length).toBeGreaterThan(0);

    // Persistido y consultable como hueco reservado.
    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.currentState).toBe("CALL_SCHEDULED");
    const booked = await repository.listBookedCallStarts();
    expect(booked).toContain(reloaded?.scheduledCallStartMs);
  });

  it("auto-agenda tambien desde READY_TO_SCHEDULE", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "READY_TO_SCHEDULE");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "el lunes a las 18"
    });
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
  });

  it("sin hora clara ('por las tardes') NO agenda; sigue el flujo normal", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "uy mejor por las tardes"
    });
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("choque con otra llamada ya reservada -> NO cambia de estado, pide otra hora", async () => {
    const { engine, repository } = createEngine();

    // Reservamos el mismo hueco que va a proponer la candidata.
    const parsed = parseProposedCallTime("manana a las 18", new Date());
    expect(parsed).not.toBeNull();
    await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "ocupa_hueco" }),
        currentState: "CALL_SCHEDULED",
        scheduledCallStartMs: parsed!.startMsUtc
      })
    );

    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18"
    });

    expect(reply.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(reply.response.toLowerCase()).toMatch(/otra|pillada|ocupad/);
  });

  it("invariante 4: NO auto-agenda desde HUMAN_INTERVENTION_REQUIRED aunque proponga hora", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "HUMAN_INTERVENTION_REQUIRED");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18 va bien"
    });
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("invariante 4: NO auto-agenda sin OK de fit (humanFitDecision PENDING)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS", { humanFitDecision: "PENDING" });
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18"
    });
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("invariante 2: si declara <18 en el MISMO turno que propone hora, NO agenda (escala/cierra, nunca CALL_SCHEDULED)", async () => {
    const { engine, repository } = createEngine();
    // Estado y fit aprobados (Alex la dio por adulta antes), pero ahora declara minoria de edad: el
    // cambio adulto->menor es una contradiccion dura que escala a Alex. Lo critico: NO se agenda llamada.
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "el lunes a las 18 me viene genial, aunque tengo 17 todavia"
    });

    // Jamas se agenda una llamada con una menor declarada; el turno deriva a revision humana o cierre.
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
    expect(["HUMAN_INTERVENTION_REQUIRED", "CLOSED"]).toContain(reply.candidate.currentState);
  });

  it("invariante 2: una candidata ya marcada como menor (<18) nunca auto-agenda y cierra (CLOSED)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS", { age: 16, isAdultConfirmed: false });
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18"
    });
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
    expect(reply.candidate.currentState).toBe("CLOSED");
  });

  it("regresion: en QUALIFYING sin OK, al completar la cualificacion va a WAITING_HUMAN_REVIEW (no auto-agenda)", async () => {
    const { engine, repository } = createEngine();
    // Candidata en cualificacion, con todos los campos requeridos resueltos pero SIN OK de fit de Alex.
    const seeded = await seed(repository, "QUALIFYING", {
      humanFitDecision: "PENDING",
      country: "Argentina",
      contentAvailability: "todas las tardes",
      experienceDescription: "ha hecho fotos",
      declaredProfileVisibility: "PUBLIC",
      phone: undefined
    });

    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18 me viene bien"
    });

    // El cierre de cualificacion sin OK humano deriva a revision humana, NUNCA a CALL_SCHEDULED.
    expect(reply.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("seguridad: con CONTROL MANUAL de Alex activo NO auto-agenda ni desactiva su control (bloqueo atomico)", async () => {
    const { engine, repository } = createEngine();
    // Candidata aprobada y en cierre de llamada, pero Alex ha tomado el control manual (pausado el bot).
    const seeded = await seed(repository, "COLLECTING_CALL_DETAILS", {
      manualControlActive: true,
      automationPaused: true
    });
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18 me viene genial"
    });

    // No agenda, el envio queda bloqueado, y NO se tocan los flags que puso Alex.
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
    expect(reply.automationBlocked).toBe(true);
    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.manualControlActive).toBe(true);
    expect(reloaded?.automationPaused).toBe(true);
    // Bloqueo atomico: nada de mensaje de agente ni transicion a CALL_SCHEDULED en el repositorio.
    const messages = await repository.listMessages(seeded.id);
    expect(messages.filter((message) => message.role === "agent")).toHaveLength(0);
    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.some((transition) => transition.toState === "CALL_SCHEDULED")).toBe(false);
  });
});
