import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug Alex 25-jun: el bot respondio bien a "49"+"es demasiado?" y LUEGO DUPLICO ("con 49 nos encaja" otra vez +
// salto al modelo de movil). CAUSA: dos entregas casi simultaneas del MISMO inbound (reintento de Meta mientras
// el 1er turno aun generaba). La 2a entraba por el reproceso de recuperacion P0-3, que NO bumpeaba la version,
// asi que ambas pasaban el send-gate con la misma version -> doble respuesta. FIX: el reproceso de recuperacion
// tambien bumpea -> versiones distintas -> el send-gate (P1-4) cancela a la obsoleta -> UNA sola respuesta.

function mk() {
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

async function setup(engine: ConversationEngine, username: string) {
  await engine.handleIncomingTurn({ instagramUsername: username, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: username, messages: [{ content: "me llamo ana" }] });
}

describe("Carrera de turno duplicado (Alex 25-jun)", () => {
  it("dos entregas concurrentes del MISMO inbound -> UNA sola respuesta enviada (la otra BLOCKED)", async () => {
    const { engine } = mk();
    const u = "race_" + Math.random().toString().slice(2, 6);
    await setup(engine, u);
    const turn = {
      instagramUsername: u,
      messages: [
        { content: "49", externalMessageId: "mid-A" },
        { content: "es demasiado?", externalMessageId: "mid-B" }
      ]
    };
    const [a, b] = await Promise.all([engine.handleIncomingTurn(turn), engine.handleIncomingTurn(turn)]);
    const sent = [a, b].filter((r) => r.deliveryStatus === "SENT" && r.response.trim().length > 0);
    const blocked = [a, b].filter((r) => r.deliveryStatus === "BLOCKED");
    // Exactamente UNA respuesta enviada; la otra se descarta por version obsoleta (no doble envio).
    expect(sent.length).toBe(1);
    expect(blocked.length).toBe(1);
    // La que sale sigue confirmando la edad (no se pierde la respuesta correcta).
    expect(sent[0].response.toLowerCase()).toMatch(/49|encaj|maduro|por la edad/);
  });

  it("un reintento del mismo inbound DESPUES de responder se ignora (dedup por mid)", async () => {
    const { engine } = mk();
    const u = "retry_" + Math.random().toString().slice(2, 6);
    await setup(engine, u);
    const turn = { instagramUsername: u, messages: [{ content: "49", externalMessageId: "mid-Z" }] };
    const first = await engine.handleIncomingTurn(turn);
    const second = await engine.handleIncomingTurn(turn);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true); // ya respondido -> ignorado, sin duplicar
  });
});
