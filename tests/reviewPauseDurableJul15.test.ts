import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): tras anunciar "voy a comentar tu perfil con mi socio", la pausa total
// se basaba en una ventana de solo 8 mensajes. Si la candidata mandaba varios acuses, el aviso del socio
// scrolleaba fuera de la ventana y el bot RE-EMITÍA el socio (contradictoria: 3 veces). La pausa debe ser
// DURABLE: una vez anunciado el socio, todo queda en visto hasta el Encaja, aunque acumule muchos acuses.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

const SOCIO = /mi socio|comentar tu perfil|lo comento/i;

describe("pausa total durable tras el socio (auditoría 15-jul)", () => {
  it("tras el socio, muchos acuses NO re-emiten el socio (queda en visto de forma durable)", async () => {
    const { engine } = createEngine();
    const username = "pausa_durable";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo cami" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 31" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "iphone 14" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "no tengo of" }); // pitch
    const socio = await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "vale" }); // socio
    expect(socio.response.toLowerCase()).toMatch(SOCIO);

    // Muchos acuses (> ventana corta de 8): NINGUNO debe re-emitir el socio; todo en visto.
    for (let i = 0; i < 12; i += 1) {
      const r = await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: `dale ${i}` });
      expect(r.response.toLowerCase(), `acuse ${i} re-emitió el socio`).not.toMatch(SOCIO);
    }
  });
});
