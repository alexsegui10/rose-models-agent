import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): "¿cuánto tardan en decirme si encajo?" es una pregunta de TIEMPOS, pero
// el token "encajo" activaba la tranquilización de EDAD ("Buscamos sobre todo perfiles maduros..."). La
// candidata lo tenía que corregir ("lo de la edad joya, decía por los tiempos nomás"). isAgeFitDoubt debe
// excluir los encuadres de tiempo/plazo. NO debe romper la duda de edad real ("¿soy demasiado mayor?").

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

const AGE_TEMPLATE = /perfiles maduros|por la edad sin problema/i;

async function drive(engine: ConversationEngine, username: string, lastMessage: string) {
  const opener = await engine.handleIncomingMessage({
    instagramUsername: username,
    profileVisibility: "PUBLIC",
    message: "hola"
  });
  const id = opener.candidate.id;
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo lucia" });
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 29" });
  return engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: lastMessage });
}

describe("no confundir TIEMPOS con EDAD (auditoría 15-jul)", () => {
  it("'¿cuánto tardan en decirme si encajo?' NO recibe la plantilla de edad", async () => {
    const { engine } = createEngine();
    const r = await drive(engine, "timing_q", "y cuanto tardan en decirme si encajo?");
    expect(r.response.toLowerCase()).not.toMatch(AGE_TEMPLATE);
  });

  it("una DUDA DE EDAD real ('¿no soy demasiado mayor para esto?') SIGUE tranquilizándose por edad", async () => {
    const { engine } = createEngine();
    const r = await drive(engine, "age_doubt", "oye y no soy demasiado mayor para esto?");
    expect(r.response.toLowerCase()).toMatch(AGE_TEMPLATE);
  });
});
