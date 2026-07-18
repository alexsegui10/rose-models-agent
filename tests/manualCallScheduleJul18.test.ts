import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { buildDmTranscript } from "@/application/callContext";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Feature de Alex (18-jul): si el bot va mal, Alex lo pausa, termina la conversacion A MANO y agenda la
// llamada MANUALMENTE desde la web (selector de candidata + dia/hora real). La transicion la dispara solo
// esta ruta (decision humana: cuenta como Encaja, invariante 4); no se envia ningun mensaje de IG.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
  return { engine, repository };
}

async function seedQualifying(engine: ConversationEngine, username: string) {
  const opener = await engine.handleIncomingMessage({
    instagramUsername: username,
    profileVisibility: "PUBLIC",
    message: "hola"
  });
  const id = opener.candidate.id;
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo dai" });
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 34" });
  return id;
}

const FUTURE = Date.now() + 60 * 60 * 1000;
const TEST_PHONE = "+54 9 11 5555 0134";

describe("agendado manual de llamada (Alex, 18-jul)", () => {
  it("agenda desde QUALIFYING con hora real: CALL_SCHEDULED + auto-marcador armado + Encaja implicito, sin mensaje de IG", async () => {
    const { engine, repository } = createEngine();
    const id = await seedQualifying(engine, "manual_ok");
    const messagesBefore = (await repository.listMessages(id, 100)).length;

    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE, phone: TEST_PHONE });

    expect(result.blockedReason).toBeUndefined();
    expect(result.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(result.candidate.scheduledCallStartMs).toBe(FUTURE);
    expect(result.candidate.scheduledCallSlot ?? "").not.toBe("");
    expect(result.candidate.phone).toContain("5555");
    expect(result.candidate.humanFitDecision).toBe("APPROVED");
    expect(result.transitions[0]?.trigger).toBe("HUMAN_MANUAL_SCHEDULE");
    // No se escribe nada a la candidata: Alex ya cerro la conversacion a mano como quiso.
    expect((await repository.listMessages(id, 100)).length).toBe(messagesBefore);
  });

  it("sin telefono (ni en la ficha ni en el formulario) -> bloqueado con motivo, sin tocar estado", async () => {
    const { engine } = createEngine();
    const id = await seedQualifying(engine, "manual_sin_tel");
    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE });
    expect(result.blockedReason ?? "").toContain("telefono");
    expect(result.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("una hora pasada o invalida -> bloqueado", async () => {
    const { engine } = createEngine();
    const id = await seedQualifying(engine, "manual_pasado");
    const past = await engine.scheduleCallManually({ candidateId: id, startMsUtc: Date.now() - 1000, phone: TEST_PHONE });
    expect(past.blockedReason ?? "").toContain("futura");
  });

  it("agenda tambien desde NEW_LEAD (Alex toma el control donde sea), y CONSERVA su pausa manual", async () => {
    const { engine, repository } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "manual_newlead",
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    // Alex tomo el control (pauso el bot) antes de agendar:
    const paused = await repository.findCandidateById(id);
    await repository.saveCandidate({ ...paused!, manualControlActive: true, automationPaused: true });

    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE, phone: TEST_PHONE });
    expect(result.blockedReason).toBeUndefined();
    expect(result.candidate.currentState).toBe("CALL_SCHEDULED");
    // Nota 3 del revisor: el agendado manual NO reactiva el bot de IG — la pausa de Alex se conserva.
    expect(result.candidate.manualControlActive).toBe(true);
    expect(result.candidate.automationPaused).toBe(true);
  });

  it("una MENOR conocida jamas se agenda (invariante 2, defensa en profundidad)", async () => {
    const { engine, repository } = createEngine();
    const id = await seedQualifying(engine, "manual_menor_ficha");
    const existing = await repository.findCandidateById(id);
    await repository.saveCandidate({ ...existing!, age: 17, isAdultConfirmed: false });
    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE, phone: TEST_PHONE });
    expect(result.blockedReason ?? "").toContain("menor");
    expect(result.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("un estado sin arista (llamada YA en curso) devuelve motivo, no un 500", async () => {
    const { engine, repository } = createEngine();
    const id = await seedQualifying(engine, "manual_in_progress");
    const existing = await repository.findCandidateById(id);
    await repository.saveCandidate({ ...existing!, currentState: "CALL_IN_PROGRESS" });
    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE, phone: TEST_PHONE });
    expect(result.blockedReason ?? "").toContain("estado actual");
    expect(result.candidate.currentState).toBe("CALL_IN_PROGRESS");
  });

  it("desde CLOSED no se agenda (terminal)", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "manual_closed",
      profileVisibility: "PUBLIC",
      message: "tengo 16 años"
    });
    expect(opener.candidate.currentState).toBe("CLOSED");
    const result = await engine.scheduleCallManually({ candidateId: opener.candidate.id, startMsUtc: FUTURE, phone: TEST_PHONE });
    expect(result.blockedReason ?? "").not.toBe("");
    expect(result.candidate.currentState).toBe("CLOSED");
  });

  it("buildDmTranscript: compacto, acotado y en 1ª persona (ELLA/YO), sin mensajes de sistema", () => {
    const messages = [
      { role: "system", content: "interno" },
      { role: "candidate", content: "hola   che,\n\nme  llamo dai" },
      { role: "agent", content: "Perfecto Dai. Que edad tienes?" },
      { role: "alex", content: "te llamo yo manana y lo vemos" },
      { role: "candidate", content: "x".repeat(500) }
    ];
    const transcript = buildDmTranscript(messages, { maxMessages: 10, maxCharsPerMessage: 100 });
    expect(transcript).toContain("ELLA: hola che, me llamo dai");
    expect(transcript).toContain("YO: Perfecto Dai. Que edad tienes?");
    expect(transcript).toContain("YO: te llamo yo manana y lo vemos"); // lo escrito A MANO por Alex tambien es YO
    expect(transcript).not.toContain("interno");
    // Recorte por mensaje: el mensaje de 500 chars queda a 100 + elipsis.
    const longLine = transcript?.split("\n").find((l) => l.includes("xxx"));
    expect((longLine ?? "").length).toBeLessThan(120);
    // Acotado por numero de mensajes.
    const many = Array.from({ length: 100 }, (_, i) => ({ role: "candidate", content: `mensaje ${i}` }));
    const capped = buildDmTranscript(many, { maxMessages: 5 });
    expect(capped?.split("\n")).toHaveLength(5);
    expect(capped).toContain("mensaje 99");
    // Sin mensajes utiles -> undefined (el contexto de llamada no lleva bloque vacio).
    expect(buildDmTranscript([{ role: "system", content: "x" }])).toBeUndefined();
  });

  it("REAGENDAR una llamada ya agendada actualiza la hora sin transicion duplicada", async () => {
    const { engine } = createEngine();
    const id = await seedQualifying(engine, "manual_reagenda");
    await engine.scheduleCallManually({ candidateId: id, startMsUtc: FUTURE, phone: TEST_PHONE });
    const later = FUTURE + 2 * 60 * 60 * 1000;
    const result = await engine.scheduleCallManually({ candidateId: id, startMsUtc: later });
    expect(result.blockedReason).toBeUndefined();
    expect(result.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(result.candidate.scheduledCallStartMs).toBe(later);
    // Sin transicion nueva (ya estaba en CALL_SCHEDULED): solo cambia la hora.
    expect(result.transitions).toHaveLength(0);
  });
});
