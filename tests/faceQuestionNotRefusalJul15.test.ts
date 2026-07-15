import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): una PREGUNTA sobre la cara ("se puede tapar o algo?") se clasificaba como
// RECHAZO (por el verbo "tapar") y, al segundo concern, CERRABA el lead. Una pregunta NO es una negativa: debe
// reconducirse (explicar por qué la cara ayuda), nunca cerrar. Un rechazo FIRME ("no la muestro") sí cierra.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

async function seedNamed(engine: ConversationEngine, username: string) {
  const opener = await engine.handleIncomingMessage({
    instagramUsername: username,
    profileVisibility: "PUBLIC",
    message: "hola"
  });
  const id = opener.candidate.id;
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo priscila" });
  return id;
}

describe("una PREGUNTA sobre la cara no es un rechazo (auditoría 15-jul)", () => {
  it("preguntar dos veces si se puede tapar/pixelar la cara NO cierra el lead (reconduce)", async () => {
    const { engine } = createEngine();
    const id = await seedNamed(engine, "cara_pregunta");
    const q1 = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "cara_pregunta",
      message: "che, lo de la cara me preocupa, se puede tapar o algo?"
    });
    expect(q1.candidate.currentState).not.toBe("CLOSED");
    const q2 = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "cara_pregunta",
      message: "y la cara se puede pixelar o difuminar?"
    });
    expect(q2.candidate.currentState).not.toBe("CLOSED");
  });

  it("un rechazo FIRME de la cara SIGUE cerrando (tras reconducir una vez)", async () => {
    const { engine } = createEngine();
    const id = await seedNamed(engine, "cara_rechazo");
    await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "cara_rechazo",
      message: "no quiero mostrar la cara"
    });
    const r2 = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "cara_rechazo",
      message: "no, en serio, la cara no la enseño ni loca"
    });
    expect(r2.candidate.currentState).toBe("CLOSED");
  });
});
