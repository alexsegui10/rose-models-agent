import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { AutomationMode } from "@/domain/automation";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { deliverDecisionOutcome } from "@/server/resumeReprocess";

// C (Alex 22-jun): cuando el bot esta EN PAUSA (revision) y la candidata sigue escribiendo, esos mensajes
// se guardan pero no se contestaban; al APROBAR solo salia un proactivo fijo. Ahora, al reanudar, el bot
// RESPONDE a lo que ella escribio en la pausa (reprocesa su ultimo bloque sin re-guardarlo). Si no escribio
// nada -> proactivo fijo. Si lo que escribio re-escala (objecion) -> no se entrega, vuelve a revision.

const FIXED_PROACTIVE = "Buenas noticias";

function setup(automationMode?: AutomationMode) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    ...(automationMode ? { automationMode } : {})
  });
  return { engine, repository };
}

async function seedReview(repository: InMemoryCandidateRepository, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `paused_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Lucia",
      age: 30,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      currentState: "WAITING_HUMAN_REVIEW",
      automationPaused: true,
      manualControlActive: true,
      ...overrides
    })
  );
}

/** La candidata escribe DURANTE la pausa: el inbound se guarda pero el bot no responde (esta pausado). */
async function candidateWritesWhilePaused(engine: ConversationEngine, instagramUsername: string, ...contents: string[]) {
  await engine.handleIncomingTurn({ instagramUsername, messages: contents.map((content) => ({ content })) });
}

describe("C: al reanudar, el bot responde a lo escrito en la pausa", () => {
  it("detecta el bloque de la pausa: APPROVE devuelve reprocessTrailingInbound y NO el proactivo fijo", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "vale, y cuando seria la llamada?");

    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(r.proposedMessage).toBeNull();
    expect(r.reprocessTrailingInbound).toEqual(["vale, y cuando seria la llamada?"]);
  });

  it("sin mensajes en la pausa -> proactivo fijo (comportamiento previo intacto)", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);

    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    expect(r.proposedMessage ?? "").toContain(FIXED_PROACTIVE);
    expect(r.reprocessTrailingInbound ?? null).toBeNull();
  });

  it("varias burbujas en la pausa se agrupan en reprocessTrailingInbound", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "hola?", "sigo interesada", "me llamais hoy?");

    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    expect(r.proposedMessage).toBeNull();
    expect(r.reprocessTrailingInbound).toEqual(["hola?", "sigo interesada", "me llamais hoy?"]);
  });

  it("la aprobacion del MOVIL (desde WAITING_HUMAN_REVIEW) tambien detecta el bloque sin contestar", async () => {
    const { engine, repository } = setup();
    // Perfil ya aprobado; falta el movil (iPhone 11 PENDING). En WAITING_HUMAN_REVIEW (no pausada: si lo
    // estuviera, su mensaje escalaria a HIR y "Movil OK" no reanuda por invariante 4). Tiene un mensaje suyo
    // sin contestar (anadido directo al historial, como si hubiera llegado durante la revision).
    const c = await seedReview(repository, {
      deviceEligibility: "PENDING_QUALITY_TEST",
      deviceModel: "iphone 11",
      humanFitDecision: "APPROVED",
      automationPaused: false,
      manualControlActive: false
    });
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: c.id,
      role: "candidate",
      author: "CANDIDATE",
      content: "seguis ahi?",
      createdAt: new Date()
    });

    const r = await engine.applyDeviceQualityDecision({ candidateId: c.id, approved: true });

    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(r.proposedMessage).toBeNull();
    expect(r.reprocessTrailingInbound).toEqual(["seguis ahi?"]);
  });

  it("doble-click en APROBAR es idempotente: el 2o no re-dispara reproceso", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "vale");

    await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    const second = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    expect(second.transitions).toEqual([]);
    expect(second.proposedMessage).toBeNull();
    expect(second.reprocessTrailingInbound ?? null).toBeNull();
  });

  it("reproceso (reprocessExisting): NO re-guarda el inbound y responde una sola vez", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "vale, cuando me llamais?");
    await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    const beforeInbound = (await repository.listMessages(c.id, 100)).filter((m) => m.role === "candidate").length;
    const reprocessed = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, cuando me llamais?" }],
      reprocessExisting: true
    });
    const after = await repository.listMessages(c.id, 100);
    const afterInbound = after.filter((m) => m.role === "candidate").length;

    // El inbound de la pausa NO se duplica (mismo conteo de mensajes de candidata).
    expect(afterInbound).toBe(beforeInbound);
    // Responde algo contextual, no el proactivo fijo.
    expect(reprocessed.response.trim().length).toBeGreaterThan(0);
    expect(reprocessed.response).not.toContain(FIXED_PROACTIVE);
  });

  it("helper deliverDecisionOutcome: con reprocessTrailingInbound responde contextual (no el fijo)", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "vale, y cuando seria?");
    const decision = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    const outcome = await deliverDecisionOutcome(engine, decision);

    expect(outcome.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(outcome.proposedMessage ?? "").not.toContain(FIXED_PROACTIVE);
    expect((outcome.proposedMessage ?? "").trim().length).toBeGreaterThan(0);
  });

  it("helper deliverDecisionOutcome: sin mensajes en pausa entrega el proactivo fijo", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    const decision = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });

    const outcome = await deliverDecisionOutcome(engine, decision);

    expect(outcome.proposedMessage ?? "").toContain(FIXED_PROACTIVE);
  });

  it("objecion en la pausa: al reanudar re-escala a HUMAN_INTERVENTION_REQUIRED y NO se entrega (invariante 4)", async () => {
    const { engine, repository } = setup("AUTOMATIC");
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "esto es una estafa, no me fio de vosotros");
    const decision = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(decision.reprocessTrailingInbound).not.toBeNull();

    const outcome = await deliverDecisionOutcome(engine, decision);

    expect(outcome.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(outcome.sentToCandidate).toBeNull();
  });

  it("HUMAN_APPROVAL: la respuesta del reproceso NO se auto-envia (canal real; queda para que Alex la apruebe)", async () => {
    // Modo real de Alex en local. Canal real-simulado (IGSID numerico) para que candidateChannel != "none":
    // asi se verifica que NO se intenta el envio (sentToCandidate=null), no que el envio "falle" por canal.
    const { engine, repository } = setup("HUMAN_APPROVAL");
    const c = await seedReview(repository, { instagramUsername: "17841400000000999" });
    await candidateWritesWhilePaused(engine, c.instagramUsername, "vale, cuando me llamais?");
    const decision = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(decision.reprocessTrailingInbound).not.toBeNull();

    const outcome = await deliverDecisionOutcome(engine, decision);

    // En HUMAN_APPROVAL la respuesta del bot (contenido del modelo) NO se auto-envia: queda PENDING para Alex.
    expect(outcome.sentToCandidate).toBeNull();
    // La respuesta propuesta SI se devuelve (Alex la ve y decide enviarla).
    expect((outcome.proposedMessage ?? "").trim().length).toBeGreaterThan(0);
  });

  // Atajo (Alex 27-jun): si lo unico que escribio en la pausa son acuses triviales ("ok", "perfecto"...),
  // al aprobar el bot va DIRECTO a proponer la llamada (proactivo fijo), sin reprocesar.
  it("acuse trivial en la pausa ('ok') -> proactivo fijo, NO reprocesa", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "ok");
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.reprocessTrailingInbound ?? null).toBeNull();
    expect(r.proposedMessage ?? "").toContain(FIXED_PROACTIVE);
  });

  it("varios acuses triviales ('ok', 'perfecto 👍') -> proactivo fijo, NO reprocesa", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "ok", "perfecto", "👍");
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.reprocessTrailingInbound ?? null).toBeNull();
    expect(r.proposedMessage ?? "").toContain(FIXED_PROACTIVE);
  });

  it("acuse + pregunta con chicha ('ok', 'pero cuando me llamais?') -> reprocesa el bloque ENTERO", async () => {
    const { engine, repository } = setup();
    const c = await seedReview(repository);
    await candidateWritesWhilePaused(engine, c.instagramUsername, "ok", "pero cuando me llamais?");
    const r = await engine.applyHumanDecision({ candidateId: c.id, decision: "APPROVE" });
    expect(r.proposedMessage).toBeNull();
    expect(r.reprocessTrailingInbound).toEqual(["ok", "pero cuando me llamais?"]);
  });
});
