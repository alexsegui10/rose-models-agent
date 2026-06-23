import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

/**
 * RED DE SEGURIDAD E2E DEL FUNNEL (Fase 0, Alex 23-jun). Determinista (sin OpenAI), corre en `npm test`.
 *
 * Esto es la DEFINICION de "MVP del bot de texto": una candidata llega desde el primer "hola" hasta una
 * llamada agendada (CALL_SCHEDULED), o a CLOSED si es menor, SOLO con mensajes entrantes + las decisiones
 * humanas que Alex toma en el CRM (applyHumanDecision / applyDeviceQualityDecision / applyProfileReviewDecision
 * / markFollowRequestSent). Cubre los 4 caminos reales. Si un fix futuro rompe el recorrido completo, ESTE
 * test se pone rojo al instante, en vez de descubrirlo a mano 7 fixes despues.
 *
 * Orden de cualificacion (verificado): nombre -> edad -> movil -> OnlyFans -> (agencias si tiene OF) ->
 * agenda (hora + telefono -> auto-agendado). Se usan frases EXPLICITAS por slot para no depender del orden
 * de la pregunta pendiente (el endurecimiento de respuestas ambiguas/negativos pelados es Fase 1).
 */

function createEngine() {
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

describe("Funnel E2E determinista: del primer 'hola' a la llamada agendada (red MVP del bot de texto)", () => {
  it("Camino 1 — SIN OnlyFans, perfil publico, movil apto -> CALL_SCHEDULED", async () => {
    const { engine } = createEngine();
    const username = "e2e_no_of";
    const send = (content: string) =>
      engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PUBLIC", messages: [{ content }] });

    await send("hola me interesa");
    await send("me llamo ana");
    await send("tengo 24");
    await send("tengo un iphone 13");
    const qualified = await send("no tengo onlyfans");

    // Datos completos -> entra a revision humana, sin filtrar nada todavia.
    expect(qualified.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(qualified.candidate.hasOnlyFans).toBe(false);
    expect(qualified.candidate.deviceEligibility).toBe("APPROVED");

    // Alex aprueba el perfil; con el movil ya apto, avanza al cierre de llamada.
    const approved = await engine.applyHumanDecision({ candidateId: qualified.candidate.id, decision: "APPROVE" });
    expect(approved.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(approved.proposedMessage).not.toBeNull();

    await send("mañana a las 18h");
    const scheduled = await send("mi numero es 612345678");

    expect(scheduled.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(scheduled.candidate.phone).toBeTruthy();
    expect(scheduled.candidate.scheduledCallSlot).toBeTruthy();
  });

  it("Camino 2 — CON OnlyFans (sin otra agencia), perfil publico -> CALL_SCHEDULED", async () => {
    const { engine } = createEngine();
    const username = "e2e_has_of";
    const send = (content: string) =>
      engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PUBLIC", messages: [{ content }] });

    await send("buenas, me interesa");
    await send("soy lucia");
    await send("tengo 25");
    await send("tengo un iphone 14");
    await send("si tengo onlyfans");
    const qualified = await send("no trabajo con ninguna agencia");

    expect(qualified.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(qualified.candidate.hasOnlyFans).toBe(true);
    expect(qualified.candidate.worksWithAnotherAgency).toBe(false);

    const approved = await engine.applyHumanDecision({ candidateId: qualified.candidate.id, decision: "APPROVE" });
    expect(approved.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");

    await send("mañana a las 18h");
    const scheduled = await send("mi numero es 612345678");

    expect(scheduled.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(scheduled.candidate.phone).toBeTruthy();
    expect(scheduled.candidate.scheduledCallSlot).toBeTruthy();
  });

  it("Camino 3 — perfil PRIVADO: solicitud + revision de perfil -> cualifica -> CALL_SCHEDULED", async () => {
    const { engine } = createEngine();
    const username = "e2e_private";
    const send = (content: string) =>
      engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PRIVATE", messages: [{ content }] });

    const opener = await send("hola me interesa");
    // Perfil privado: el bot no cualifica, espera acceso al perfil.
    expect(opener.candidate.currentState).toBe("WAITING_PROFILE_ACCESS");

    // Alex envia la solicitud (la API de IG no permite auto-follow) y revisa el perfil cuando ella acepta.
    const followed = await engine.markFollowRequestSent({ candidateId: opener.candidate.id });
    const reviewed = await engine.applyProfileReviewDecision({ candidateId: opener.candidate.id, fits: true });
    expect(reviewed.candidate.currentState).toBe("QUALIFYING");

    await send("me llamo ana");
    await send("tengo 24");
    await send("tengo un iphone 13");
    const qualified = await send("no tengo onlyfans");
    expect(qualified.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");

    const approved = await engine.applyHumanDecision({ candidateId: qualified.candidate.id, decision: "APPROVE" });
    expect(approved.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");

    await send("mañana a las 18h");
    const scheduled = await send("mi numero es 612345678");
    expect(scheduled.candidate.currentState).toBe("CALL_SCHEDULED");

    // markFollowRequestSent se uso (la candidata se considero con solicitud enviada).
    expect(followed.candidate.id).toBe(opener.candidate.id);
  });

  it("Camino 4 — MENOR de edad -> CLOSED (invariante 2), sin pitch ni avance", async () => {
    const { engine } = createEngine();
    const username = "e2e_minor";
    const send = (content: string) =>
      engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PUBLIC", messages: [{ content }] });

    await send("holaa me interesa");
    const minor = await send("tengo 16");

    expect(minor.candidate.currentState).toBe("CLOSED");
    // No se avanza a revision humana ni se filtra el pitch a una menor.
    expect(minor.response.toLowerCase()).not.toContain("70");
  });

  it("Camino 5 — movil generico ('un iphone' sin modelo): doble gate humano (perfil + calidad) -> CALL_SCHEDULED", async () => {
    // Caso muy comun y origen del 'se queda muda': aprobar el perfil NO basta si el movil quedo en
    // PENDING_QUALITY_TEST; hace falta tambien la decision de calidad del movil. Este test fija el
    // comportamiento ACTUAL (dos decisiones) para que Fase 1 mejore la VISIBILIDAD en el CRM sin romperlo.
    const { engine } = createEngine();
    const username = "e2e_generic_iphone";
    const send = (content: string) =>
      engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PUBLIC", messages: [{ content }] });

    await send("hola me interesa");
    await send("me llamo carla");
    await send("tengo 27");
    await send("tengo un iphone");
    const qualified = await send("no tengo onlyfans");

    expect(qualified.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(qualified.candidate.deviceEligibility).toBe("PENDING_QUALITY_TEST");

    // Aprobar SOLO el perfil no avanza: el movil sigue pendiente de calidad.
    const profileApproved = await engine.applyHumanDecision({ candidateId: qualified.candidate.id, decision: "APPROVE" });
    expect(profileApproved.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");

    // Aprobar la calidad del movil desbloquea el avance al cierre de llamada.
    const deviceApproved = await engine.applyDeviceQualityDecision({ candidateId: qualified.candidate.id, approved: true });
    expect(deviceApproved.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");

    await send("mañana a las 18h");
    const scheduled = await send("mi numero es 612345678");
    expect(scheduled.candidate.currentState).toBe("CALL_SCHEDULED");
  });
});
