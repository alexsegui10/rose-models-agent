import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Peticion de Alex (7-jul): el "lo comento con mi socio" NO debe dispararse si ella tiene ANTES una duda
// CONTESTABLE. El bot debe responder la duda primero; solo cuando no hay nada que responder sale el socio-pause.
// (Regla de Alex del 5-jul ya implementada: en revision, una pregunta con respuesta aprobada SE RESPONDE.)

const SOCIO = /comento con mi socio|comentar tu perfil con mi socio|con mi socio/i;

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

// Lleva la conversacion hasta JUSTO despues del pitch (estado WAITING_HUMAN_REVIEW), ANTES de que se diga el
// mensaje del socio (ese sale en el siguiente turno si no hay nada que responder).
async function toJustAfterPitch(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 30" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
  const of = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido of" }] });
  return of.candidate;
}

describe("Socio-pause NO se dispara si hay una duda contestable (Alex 7-jul)", () => {
  it("si pregunta el % justo despues del pitch, RESPONDE el 70/30 y NO suelta el socio-pause", async () => {
    const { engine } = mk();
    const u = "sp_pct_" + Math.random().toString().slice(2, 6);
    const after = await toJustAfterPitch(engine, u);
    expect(after.currentState).toBe("WAITING_HUMAN_REVIEW");

    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye y cuanto me llevo yo de lo que se gana?" }]
    });
    expect(r.response).toMatch(/70|30/); // responde la cifra que pregunta
    expect(r.response).not.toMatch(SOCIO); // NO pausa con el socio dejando la duda sin contestar
  });

  it("si pregunta como trabajais justo despues del pitch, lo EXPLICA y NO suelta el socio-pause", async () => {
    const { engine } = mk();
    const u = "sp_met_" + Math.random().toString().slice(2, 6);
    await toJustAfterPitch(engine, u);

    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y como trabajais exactamente? que haceis vosotros?" }]
    });
    // Responde con el metodo (contenido/monetizacion/trafico/gestion), sin soltar el socio-pause.
    expect(r.response.toLowerCase()).toMatch(/contenido|monetiz|trafico|gestion|nosotros/);
    expect(r.response).not.toMatch(SOCIO);
  });

  it("(control) si NO tiene ninguna duda, SI sale el mensaje del socio", async () => {
    const { engine } = mk();
    const u = "sp_ctrl_" + Math.random().toString().slice(2, 6);
    await toJustAfterPitch(engine, u);

    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "vale genial" }] });
    expect(r.response).toMatch(SOCIO);
  });
});
