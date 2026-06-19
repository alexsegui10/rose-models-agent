import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Decision de Alex (14-jun): si la candidata NO ha trabajado con agencias, no sabe en que consiste,
// asi que el bot le explica como trabajamos PROACTIVAMENTE (sin que pregunte "como trabajais").

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

describe("agency pitch is delivered proactively when the candidate has no agency experience", () => {
  it("asks for the movil first and only then explains how the agency works (orden nuevo: edad -> movil -> OF -> pitch)", async () => {
    const { engine } = createEngine();
    const username = "no_agency_pitch";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo ana" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 25" });
    // Orden nuevo (Alex 19-jun): el movil se pregunta ANTES que OF. La candidata responde lo de OF
    // (es inexperta: nunca ha tenido OF) MIENTRAS el movil sigue pendiente, asi que el guion esencial
    // todavia NO esta completo (falta el movil) y el pitch NO debe salir aun.
    const afterOnlyFans = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no, nunca he tenido of"
    });

    expect(afterOnlyFans.candidate.hasOnlyFans).toBe(false);
    // El pitch va DESPUES del movil: aqui el bot todavia esta pidiendo el movil, sin explicar nada.
    expect(afterOnlyFans.response.toLowerCase()).toContain("movil");
    expect(afterOnlyFans.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);

    // Al dar el movil se COMPLETA el guion esencial: AHORA si llega el pitch operativo (cuentas de
    // Instagram + chatters) y se cierra invitando a preguntar.
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "tengo un iphone 13"
    });
    expect(result.candidate.deviceEligibility).not.toBe("UNKNOWN");
    expect(result.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);
    expect(result.response.toLowerCase()).toContain("cualquier duda me preguntas");

    // Anti-bucle: seguir hablando NO vuelve a soltar el pitch.
    const again = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "vale, entendido"
    });
    expect(again.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);
  });
});
