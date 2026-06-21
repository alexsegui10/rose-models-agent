import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

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

const WINDOW = 55000;
const T0 = new Date("2026-06-21T12:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

// Debounce entrante (QStash): bufferiza sin responder; responde a toda la rafaga cuando ella para ~55s.
describe("bufferInboundForDebounce / flushPendingInbound", () => {
  it("bufferiza sin responder y es idempotente por externalMessageId", async () => {
    const { engine, repository } = createEngine();
    const first = await engine.bufferInboundForDebounce({
      instagramUsername: "deb1",
      messages: [{ content: "hola me interesa", externalMessageId: "m1" }],
      now: T0
    });
    expect(first.buffered).toBe(1);
    expect(first.candidate.pendingInbound).toHaveLength(1);
    // No se anade a la conversacion todavia (esta EN ESPERA), ni responde.
    expect(await repository.listMessages(first.candidate.id)).toHaveLength(0);
    // Mismo externalMessageId -> no se duplica.
    const again = await engine.bufferInboundForDebounce({
      instagramUsername: "deb1",
      messages: [{ content: "hola me interesa", externalMessageId: "m1" }],
      now: at(2000)
    });
    expect(again.buffered).toBe(0);
    expect(again.candidate.pendingInbound).toHaveLength(1);
  });

  it("NO vacia si sigue dentro de la ventana (escribiendo)", async () => {
    const { engine } = createEngine();
    await engine.bufferInboundForDebounce({
      instagramUsername: "deb2",
      messages: [{ content: "hola", externalMessageId: "m1" }],
      now: T0
    });
    const flushed = await engine.flushPendingInbound({ instagramUsername: "deb2", windowMs: WINDOW, now: at(10000) });
    expect(flushed).toBeNull();
  });

  it("vacia y responde a TODA la rafaga cuando ya paso la ventana, y limpia la espera", async () => {
    const { engine, repository } = createEngine();
    await engine.bufferInboundForDebounce({
      instagramUsername: "deb3",
      messages: [{ content: "hola", externalMessageId: "m1" }],
      now: T0
    });
    await engine.bufferInboundForDebounce({
      instagramUsername: "deb3",
      messages: [{ content: "me interesa", externalMessageId: "m2" }],
      now: at(8000)
    });

    const flushed = await engine.flushPendingInbound({ instagramUsername: "deb3", windowMs: WINDOW, now: at(70000) });
    expect(flushed).not.toBeNull();
    // La rafaga ya esta en la conversacion (se anadio al responder).
    const candidate = await repository.findCandidateByInstagram("deb3");
    expect(candidate?.pendingInbound).toHaveLength(0);
    const messages = await repository.listMessages(candidate!.id);
    expect(messages.filter((m) => m.role === "candidate").length).toBeGreaterThanOrEqual(2);

    // Idempotente: un callback repetido tras vaciar no responde otra vez.
    const repeat = await engine.flushPendingInbound({ instagramUsername: "deb3", windowMs: WINDOW, now: at(80000) });
    expect(repeat).toBeNull();
  });
});
