import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Peticion de Alex (7-jul): tras "lo comento con mi socio" el bot PAUSA (silencio). Al dar el Encaja, si ella
// escribio una DUDA durante la pausa, el bot debe PRIMERO resolver esa duda y LUEGO agendar la llamada.

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

async function toSocioPause(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "31" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
  const of = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido" }] }); // pitch -> WAITING
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok gracias" }] }); // se dice lo del socio
  return of.candidate.id;
}

describe("Reanudar tras la pausa (actualizado 18-jul: la duda cubierta ya se respondio EN la pausa)", () => {
  it("la duda del % en la pausa se responde AL MOMENTO (una vez) y el Encaja va directo al proactivo de la llamada", async () => {
    // ACTUALIZADO 18-jul (decision de Alex, sustituye la pausa TOTAL del 6-jul): la pregunta cubierta ya no
    // espera al Encaja — se responde una vez durante la pausa. Al aprobar, no queda duda pendiente que
    // reprocesar y sale el proactivo fijo proponiendo la llamada.
    const { engine } = mk();
    const u = "resume_" + Math.random().toString().slice(2, 6);
    const candidateId = await toSocioPause(engine, u);

    // Escribe una duda del % DURANTE la pausa -> se responde una vez (antes: visto hasta el Encaja).
    const paused = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye y cuanto me pagais? que porcentaje?" }]
    });
    expect(paused.response).toMatch(/70|30/);

    // Alex da el Encaja: la duda ya esta respondida, asi que no hay reproceso y sale el proactivo fijo.
    const decision = await engine.applyHumanDecision({ candidateId, decision: "APPROVE" });
    expect(decision.reprocessTrailingInbound ?? null).toBeNull();
    expect((decision.proposedMessage ?? "").toLowerCase()).toMatch(/llamada|dia|hora|llamar/);
  });
});
