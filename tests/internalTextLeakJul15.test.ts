import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): el bot filtraba a la candidata una INSTRUCCIÓN INTERNA de su guion de
// seguimiento ("Si no responde, se puede hacer seguimiento limitado, no insistir indefinidamente") como si
// fuera un mensaje para ella. Es un sinsentido de cara a la candidata. La ficha follow-up-limited-attempts
// debe estar redactada en VOZ DE CARA A ELLA (2ª persona), nunca recitar la política interna en 3ª persona.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

// Voz interna de política (3ª persona / impersonal) que NUNCA debe llegar a la candidata.
const INTERNAL_VOICE = /se puede hacer seguimiento|no insistir indefinidamente|si no responde|se envian? |se realizan?|intentos/i;

describe("no filtrar la política interna de seguimiento (auditoría 15-jul)", () => {
  it("cuando surface la ficha de seguimiento, la respuesta va en voz de cara a la candidata, sin la instrucción interna", async () => {
    const { engine } = createEngine();
    const username = "seguimiento_leak";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo eva" });
    // "insistir" dispara la ficha follow-up-limited-attempts (retriever).
    const r = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "y me vais a insistir mucho si no contesto?"
    });
    expect(r.response.toLowerCase()).not.toMatch(INTERNAL_VOICE);
  });
});
