import { describe, expect, it } from "vitest";
import { ConversationEngine, type ConversationEngineDependencies } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine(
  beforeSendCheck?: ConversationEngineDependencies["beforeSendCheck"],
  automationMode: ConversationEngineDependencies["automationMode"] = "AUTOMATIC"
) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    automationMode,
    beforeSendCheck
  });

  return { engine, repository };
}

// Mensaje de cualificacion completo: sin carrera, este turno avanzaria de estado, persistiria una
// transicion y enviaria una respuesta del agente. Es el escenario "fuerte" para comprobar que la
// cancelacion bloquea TODO eso.
const QUALIFYING_MESSAGE = "Hola, tengo 23, soy de Madrid, tengo experiencia y un iPhone 13, disponible por las tardes";

describe("generationCancellationVersion (carrera de respuestas obsoletas)", () => {
  it("bloquea la respuesta en vuelo cuando un mensaje nuevo sube la version de generacion antes del envio", async () => {
    // Simulamos la carrera real desde el unico punto donde el motor reconsulta el repositorio antes
    // de enviar (beforeSendCheck -> latestCandidateBeforeSend): justo antes del send, "llega" un
    // mensaje nuevo que guarda al candidato con una generationCancellationVersion MAYOR. El motor
    // recarga ese candidato del repo, ve que la version ya no coincide con la del turno en vuelo y
    // descarta la respuesta vieja.
    const { engine, repository } = createEngine(async (candidate) => {
      await repository.saveCandidate({
        ...candidate,
        generationCancellationVersion: candidate.generationCancellationVersion + 1,
        updatedAt: new Date()
      });
      return candidate;
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "race_case",
      profileVisibility: "PUBLIC",
      message: QUALIFYING_MESSAGE
    });

    expect(result.automationBlocked).toBe(true);
    expect(result.response).toBe("");
    expect(result.deliveryStatus).toBe("BLOCKED");

    // El motor SI tenia un plan que avanzaba de estado (la cualificacion no se ignora), pero esa
    // transicion NO debe persistirse: la respuesta es obsoleta porque ya entro un mensaje mas nuevo.
    expect(result.plannedTransitions.length).toBeGreaterThan(0);

    const storedMessages = await repository.listMessages(result.candidate.id);
    const storedTransitions = await repository.listTransitions(result.candidate.id);
    // Sin mensaje de agente: la respuesta vieja se descarto. Sin transicion persistida.
    expect(storedMessages.filter((message) => message.role === "agent")).toHaveLength(0);
    expect(storedTransitions).toHaveLength(0);
    // El mensaje entrante de la candidata SI quedo guardado (llego antes del punto de bloqueo).
    expect(storedMessages.filter((message) => message.role === "candidate")).toHaveLength(1);
  });

  it("descarta la respuesta obsoleta SIN pausar la automatizacion (el turno mas nuevo responde) [P1-4]", async () => {
    // Cambio P1-4: con el bump ATOMICO de version, el version-stale es la senal NORMAL del turno PERDEDOR
    // de una carrera de concurrencia; el GANADOR (turno mas nuevo) es quien responde. Pausar al perdedor
    // dejaria muda a la candidata (el ganador tambien se bloquearia por la pausa). Por eso el turno obsoleto
    // se descarta sin tocar el estado. (El bloqueo por CONTROL MANUAL si sigue pausando: ver
    // concurrencyVersionJun22.test.ts.)
    const { engine, repository } = createEngine(async (candidate) => {
      await repository.saveCandidate({
        ...candidate,
        generationCancellationVersion: candidate.generationCancellationVersion + 5,
        updatedAt: new Date()
      });
      return candidate;
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "race_pause_case",
      profileVisibility: "PUBLIC",
      message: QUALIFYING_MESSAGE
    });

    expect(result.automationBlocked).toBe(true);
    expect(result.candidate.automationPaused).toBe(false);

    const stored = await repository.findCandidateById(result.candidate.id);
    expect(stored?.automationPaused).toBe(false);
  });

  it("envia normalmente cuando NO hay carrera: la version de generacion del turno sigue siendo la actual", async () => {
    // Caso de control: el beforeSendCheck no toca la version. El motor confirma que la version del
    // turno en vuelo sigue siendo la ultima del repo y entrega la respuesta con su transicion.
    const { engine, repository } = createEngine(async (candidate) => candidate);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "no_race_case",
      profileVisibility: "PUBLIC",
      message: QUALIFYING_MESSAGE
    });

    expect(result.automationBlocked).toBe(false);
    expect(result.deliveryStatus).toBe("SENT");
    expect(result.response.trim().length).toBeGreaterThan(0);

    const storedMessages = await repository.listMessages(result.candidate.id);
    const storedTransitions = await repository.listTransitions(result.candidate.id);
    expect(storedMessages.filter((message) => message.role === "agent")).toHaveLength(1);
    expect(storedTransitions.length).toBeGreaterThan(0);
  });

  it("regression: cada turno incrementa la version de generacion del candidato persistido", async () => {
    // El mecanismo de cancelacion depende de que CADA turno entrante suba la version. Si esto se
    // rompe, dos mensajes consecutivos tendrian la misma version y una respuesta obsoleta podria
    // colarse. Verificamos el contrato base que sostiene la carrera.
    const { engine, repository } = createEngine();

    const first = await engine.handleIncomingMessage({
      instagramUsername: "version_bump_case",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    const afterFirst = await repository.findCandidateById(first.candidate.id);
    const versionAfterFirst = afterFirst?.generationCancellationVersion ?? 0;
    expect(versionAfterFirst).toBeGreaterThan(0);

    await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "version_bump_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 24 y soy de Sevilla"
    });
    const afterSecond = await repository.findCandidateById(first.candidate.id);
    expect(afterSecond?.generationCancellationVersion ?? 0).toBeGreaterThan(versionAfterFirst);
  });
});
