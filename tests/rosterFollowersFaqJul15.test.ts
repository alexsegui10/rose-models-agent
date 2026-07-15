import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): "¿cuántas chicas llevan?" y "¿cuántos seguidores tendré?" no tenían ruta
// -> se surfaceaba una ficha equivocada (tiempos de lanzamiento) = non-sequitur. Ahora responden su FAQ
// dedicada (contenido de Alex 15-jul: ~5 chicas; 5k-20k seguidores en un mes, enmarcado como lo que HACEN).

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

async function ask(engine: ConversationEngine, username: string, question: string) {
  const opener = await engine.handleIncomingMessage({
    instagramUsername: username,
    profileVisibility: "PUBLIC",
    message: "hola"
  });
  const id = opener.candidate.id;
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo tere" });
  return engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: question });
}

describe("FAQ de roster y seguidores (auditoría 15-jul)", () => {
  it("'¿cuántas chicas llevan?' responde el tamaño del equipo (unas 5), no un non-sequitur", async () => {
    const { engine } = createEngine();
    const r = await ask(engine, "roster_q", "y cuantas chicas llevan ustedes?");
    expect(r.response.toLowerCase()).toMatch(/5 chicas|equipo pequeno|equipo pequeño|unas 5/);
  });

  it("'¿cuántos seguidores tendré?' responde el rango (5k-20k), sin garantizarlo ni filtrar reparto", async () => {
    const { engine } = createEngine();
    const r = await ask(engine, "followers_q", "y cuantos seguidores voy a tener?");
    expect(r.response.toLowerCase()).toMatch(/5\.?000|20\.?000|5k|20k/);
    expect(r.response).not.toMatch(/70\s?%|30\s?%/);
  });
});
