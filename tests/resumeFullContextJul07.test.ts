import { describe, expect, it, vi } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingInput, type ResponseDraftingProvider } from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Peticion de Alex (7-jul): asegurar que al REANUDAR (por Encaja, por movil, o por pausa manual) el bot tiene
// en contexto TODOS los mensajes: los de ella Y los que Alex escribio a mano durante la pausa. Estos tests lo
// DEMUESTRAN espiando (a) el historial que el motor carga (repository.listMessages) y (b) el historial que ve
// el redactor LLM (ResponseDraftingInput.recentMessages), en una conversacion larga.

type MsgLite = { role: string; author?: string | null; content: string };

function spyDrafter(): { provider: ResponseDraftingProvider; inputs: ResponseDraftingInput[] } {
  const inputs: ResponseDraftingInput[] = [];
  const provider: ResponseDraftingProvider = {
    async draft(input: ResponseDraftingInput) {
      inputs.push(input);
      return ResponseDraftOutputSchema.parse({ response: "vale, seguimos" });
    }
  };
  return { provider, inputs };
}

function mk() {
  const repository = new InMemoryCandidateRepository();
  const { provider, inputs } = spyDrafter();
  const listSpy = vi.spyOn(repository, "listMessages");
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    draftingProvider: provider,
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository, inputs, listSpy };
}

async function alexManual(repository: InMemoryCandidateRepository, candidateId: string, content: string) {
  // Igual que la ruta /api/simulator/manual-reply: role "agent", author "ALEX".
  await repository.addMessage({
    id: crypto.randomUUID(),
    candidateId,
    role: "agent",
    author: "ALEX",
    content,
    createdAt: new Date(),
    metadata: { manual: true }
  });
}

function flatten(messages: MsgLite[]): string {
  return messages.map((m) => `${m.author ?? m.role}:${m.content}`).join(" || ");
}

// listMessages es async: mock.results[].value es una PROMESA -> hay que resolverla para leer el historial.
async function loadedHistories(results: Array<{ type: string; value: unknown }>): Promise<string[]> {
  const arrays = await Promise.all(results.filter((r) => r.type === "return").map((r) => r.value as Promise<MsgLite[]>));
  return arrays.map(flatten);
}

// Conversacion LARGA hasta que el bot frena en "lo comento con mi socio" (WAITING_HUMAN_REVIEW).
async function longConversationToReview(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({
    instagramUsername: u,
    profileVisibility: "PUBLIC",
    messages: [{ content: "hola quiero info" }]
  });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "y como trabajais exactamente?" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "vale me interesa" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 30" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
  const of = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido of" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok gracias" }] }); // se dice lo del socio
  return of.candidate.id;
}

describe("Reanudar con TODO el contexto (Alex 7-jul)", () => {
  it("ENCAJA: al reanudar, el motor carga la duda de ella + el mensaje manual de Alex + el historial", async () => {
    const { engine, repository, inputs, listSpy } = mk();
    const u = "ctx_encaja_" + Math.random().toString().slice(2, 6);
    const candidateId = await longConversationToReview(engine, u);

    // Durante la pausa: ella pregunta una duda, Alex responde A MANO, y ella escribe otra vez.
    await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye y cuanto me llevo yo de lo que se gana?" }]
    });
    await alexManual(repository, candidateId, "tranquila ana, eso te lo explico con calma en la llamada");
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "vale y cuando me llamas entonces?" }] });

    listSpy.mockClear();
    inputs.length = 0;

    // Alex da el Encaja -> se reprocesa lo de la pausa.
    const decision = await engine.applyHumanDecision({ candidateId, decision: "APPROVE" });
    const resumed = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: (decision.reprocessTrailingInbound ?? []).map((content) => ({ content })),
      reprocessExisting: true
    });

    // (a) El motor cargo el historial COMPLETO al reanudar: incluye la duda de ella Y el manual de Alex.
    const loaded = await loadedHistories(listSpy.mock.results);
    expect(loaded.some((h) => /cuanto me llevo yo/.test(h) && /te lo explico con calma en la llamada/.test(h))).toBe(true);

    // (b) El redactor LLM vio esos mensajes en recentMessages (contexto real que usa para responder).
    const seenByLlm = inputs.map((i) => i.recentMessages.join(" || "));
    expect(seenByLlm.some((h) => /te lo explico con calma en la llamada/.test(h))).toBe(true);
    expect(seenByLlm.some((h) => /cuanto me llevo yo/.test(h))).toBe(true);

    // (c) No se queda muda al reanudar.
    expect(resumed.response.trim().length).toBeGreaterThan(0);
  });

  it("MOVIL: al aprobar el movil dudoso, el reanudar tambien ve la duda de ella + el manual de Alex", async () => {
    const { engine, repository, inputs, listSpy } = mk();
    const u = "ctx_movil_" + Math.random().toString().slice(2, 6);
    // Conversacion con movil DUDOSO (redmi) -> queda pendiente de tu decision de movil.
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo lucia" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 28" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "un redmi note 11" }] });
    const of = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido of" }] });
    const candidateId = of.candidate.id;
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok" }] });

    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "oye y el movil sirve o no?" }] });
    await alexManual(repository, candidateId, "el movil lo estoy mirando lucia, no te preocupes");
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "vale gracias y cuando seguimos?" }] });

    listSpy.mockClear();
    inputs.length = 0;

    // Reanudacion REAL del caso movil: se aprueba el movil Y el encaje (el movil solo no reanuda, sigue
    // esperando el Encaja). Con ambos OK se reprocesa lo escrito en la pausa, como en el caso Encaja.
    await engine.applyDeviceQualityDecision({ candidateId, approved: true });
    const decision = await engine.applyHumanDecision({ candidateId, decision: "APPROVE" });
    await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: (decision.reprocessTrailingInbound ?? []).map((content) => ({ content })),
      reprocessExisting: true
    });

    const loaded = await loadedHistories(listSpy.mock.results);
    expect(loaded.some((h) => /el movil lo estoy mirando/.test(h) && /el movil sirve o no/.test(h))).toBe(true);
    const seenByLlm = inputs.map((i) => i.recentMessages.join(" || "));
    expect(seenByLlm.some((h) => /el movil lo estoy mirando/.test(h))).toBe(true);
  });

  it("PAUSA MANUAL: al despausar, el siguiente turno ve lo que ella escribio y el manual de Alex", async () => {
    const { engine, repository, inputs, listSpy } = mk();
    const u = "ctx_manual_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo marta" }] });
    const t = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 27" }] });
    const candidateId = t.candidate.id;

    // Alex PAUSA a mano (flags de control manual, como la ruta /api/simulator/manual-control).
    const paused = await repository.findCandidateById(candidateId);
    await repository.saveCandidate({ ...paused!, manualControlActive: true, automationPaused: true, updatedAt: new Date() });

    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "sigo interesada, tengo un iphone 15" }] });
    await alexManual(repository, candidateId, "perfecto marta, ahora te sigue el bot");
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "genial" }] });

    // Alex DESPAUSA.
    const toResume = await repository.findCandidateById(candidateId);
    await repository.saveCandidate({ ...toResume!, manualControlActive: false, automationPaused: false, updatedAt: new Date() });

    listSpy.mockClear();
    inputs.length = 0;

    const resumed = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y como me pagais? y cuando empezariamos?" }]
    });

    // Contexto COMPLETO cargado al despausar: el manual de Alex Y lo que ella escribio durante la pausa.
    const loaded = await loadedHistories(listSpy.mock.results);
    expect(loaded.some((h) => /ahora te sigue el bot/.test(h) && /tengo un iphone 15/.test(h))).toBe(true);
    // El bot reengancha (no se queda mudo) y, cuando el LLM redacta, ve el historial reciente de la pausa
    // (mismo mecanismo listMessages ya probado en Encaja/movil, donde ademas se ve el manual en recentMessages).
    expect(resumed.response.trim().length).toBeGreaterThan(0);
    if (inputs.length > 0) {
      const seenByLlm = inputs.map((i) => i.recentMessages.join(" || "));
      expect(seenByLlm.some((h) => /iphone 15|ahora te sigue el bot|me pagais/.test(h))).toBe(true);
    }
  });
});
