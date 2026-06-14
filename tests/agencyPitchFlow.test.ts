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
  it("explains how the agency works right after she says she has not worked with agencies", async () => {
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
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "si he tenido of" });
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "no, nunca con agencias"
    });

    expect(result.candidate.worksWithAnotherAgency).toBe(false);
    // La respuesta es el pitch operativo (mecanismo de cuentas de Instagram + chatters), no otra pregunta.
    expect(result.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);

    // Anti-bucle: repetir que no trabaja con agencias NO vuelve a soltar el pitch.
    const again = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "que no, nunca he trabajado con ninguna agencia"
    });
    expect(again.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);
  });
});
