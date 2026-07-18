import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Peticion de Alex (14-jul, REVIERTE la regla del 7-jul): tras el pitch, si ella pregunta una duda
// CONTESTABLE, el bot la RESPONDE Y cierra con "lo comento con mi socio" en el MISMO mensaje; a partir de ahi,
// pausa total (en visto) hasta el Encaja. La duda NUNCA se ignora (se responde), pero ya no se queda "abierto"
// respondiendo dudas sin fin — eso hacia que no pausara (spot-check de Sofia). El reproceso, al dar Encaja,
// lee y contesta lo que ella escribio durante la pausa.

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

describe("Tras el pitch: responde la duda Y cierra con el socio, luego pausa (Alex 14-jul)", () => {
  it("si pregunta el % justo despues del pitch, RESPONDE el 70/30 Y cierra con el socio en el mismo mensaje", async () => {
    const { engine } = mk();
    const u = "sp_pct_" + Math.random().toString().slice(2, 6);
    const after = await toJustAfterPitch(engine, u);
    expect(after.currentState).toBe("WAITING_HUMAN_REVIEW");

    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "oye y cuanto me llevo yo de lo que se gana?" }]
    });
    expect(r.response).toMatch(/70|30/); // responde la cifra que pregunta (NUNCA la ignora)
    expect(r.response).toMatch(SOCIO); // ...y cierra con el socio en el mismo mensaje (Alex 14-jul)
  });

  it("si pregunta como trabajais justo despues del pitch, lo EXPLICA Y cierra con el socio en el mismo mensaje", async () => {
    const { engine } = mk();
    const u = "sp_met_" + Math.random().toString().slice(2, 6);
    await toJustAfterPitch(engine, u);

    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y como trabajais exactamente? que haceis vosotros?" }]
    });
    // Responde con el metodo (contenido/monetizacion/trafico/gestion) Y cierra con el socio (Alex 14-jul).
    expect(r.response.toLowerCase()).toMatch(/contenido|monetiz|trafico|gestion|nosotros/);
    expect(r.response).toMatch(SOCIO);
  });

  it("(control) si NO tiene ninguna duda, SI sale el mensaje del socio", async () => {
    const { engine } = mk();
    const u = "sp_ctrl_" + Math.random().toString().slice(2, 6);
    await toJustAfterPitch(engine, u);

    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "vale genial" }] });
    expect(r.response).toMatch(SOCIO);
  });

  it("una SEGUNDA duda cubierta, ya dicho el socio, se responde UNA vez sin re-cerrar con el socio (Alex 18-jul)", async () => {
    // ACTUALIZADO 18-jul (decision explicita de Alex, sustituye la pausa TOTAL del 6-jul que fijaba este
    // test): en pausa, una pregunta CUBIERTA se responde UNA sola vez y se vuelve al visto. Antes: Ale
    // pregunto "¿como me pagan?" 5 veces y recibio 5 vistos (barrido real).
    const { engine } = mk();
    const u = "sp_pausa_" + Math.random().toString().slice(2, 6);
    await toJustAfterPitch(engine, u);

    // 1a duda: se responde Y se cierra con el socio en el mismo mensaje.
    const first = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "oye y cuanto me llevo yo?" }] });
    expect(first.response).toMatch(SOCIO);

    // 2a duda (ya en pausa), de OTRO tema cubierto: se responde (sin repetir el cierre del socio) y
    // re-preguntar lo mismo NUNCA repite lo dicho — va agotando lo no dicho y converge al visto.
    const second = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y la cuenta quien la abre?" }]
    });
    expect(second.response.trim().length).toBeGreaterThan(0);
    expect(second.response).not.toMatch(SOCIO);

    const seenBubbles = new Set(second.response.split(/\n{2,}/).map((b) => b.trim()));
    let last = second.response;
    for (let i = 0; i < 8 && last.trim().length > 0; i += 1) {
      const again = await engine.handleIncomingTurn({
        instagramUsername: u,
        messages: [{ content: "y la cuenta quien la abre?" }]
      });
      last = again.response;
      for (const bubble of last
        .split(/\n{2,}/)
        .map((b) => b.trim())
        .filter(Boolean)) {
        expect(seenBubbles.has(bubble), `burbuja repetida: ${bubble}`).toBe(false);
        seenBubbles.add(bubble);
      }
    }
    expect(last.trim()).toBe(""); // converge al visto: el "una vez" es real
  });
});
