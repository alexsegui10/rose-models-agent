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

describe("Reanudar: primero resuelve la duda de la pausa, luego agenda (Alex 7-jul)", () => {
  it("tras el Encaja, la duda escrita en la pausa se RESPONDE y se PROPONE la llamada", async () => {
    const { engine } = mk();
    const u = "resume_" + Math.random().toString().slice(2, 6);
    const candidateId = await toSocioPause(engine, u);

    // Escribe una duda DURANTE la pausa -> pausa total (silencio), queda pendiente.
    const paused = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye y cuanto me pagais? que porcentaje?" }]
    });
    expect(paused.response.trim()).toBe(""); // silencio: no le contesta hasta el Encaja

    // Alex da el Encaja.
    const decision = await engine.applyHumanDecision({ candidateId, decision: "APPROVE" });
    // Al haber duda en la pausa, el proactivo fijo se anula y se reprocesa su mensaje.
    expect(decision.reprocessTrailingInbound?.length).toBeGreaterThan(0);

    // El reproceso: responde la duda (%) Y propone la llamada.
    const resumed = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: (decision.reprocessTrailingInbound ?? []).map((content) => ({ content })),
      reprocessExisting: true
    });
    const lower = resumed.response.toLowerCase();
    // Resuelve la duda del %.
    expect(lower).toMatch(/70|30|porcentaje|reparto/);
    // Y agenda (propone dia/hora/llamada).
    expect(lower).toMatch(/dia|hora|llamada|te llamo/);
  });
});
