import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regla de Alex (esere.md, caso Constanza 6-jul): el bot NUNCA afirma el encaje/aceptacion por su cuenta
// en cualificacion ("con 37 te encaja bien" -> mal). El encaje lo decide Alex (invariante 4). Confirmar la
// edad esta bien ("perfecto", "por la edad sin problema", "maduros"), pero SIN decir "encaja". Este test
// fija la rama DETERMINISTA isAgeFitDoubt (cuando la candidata duda de si su edad sirve). El camino LLM
// tiene la misma regla en el prompt (buildDraftingInstructions), pero eso no se testea en determinista.

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

describe("Wording del encaje por edad (Alex 6-jul, Constanza)", () => {
  it("ante duda de edad, tranquiliza SIN afirmar el encaje ('nos encaja'/'te encaja'/'estas dentro')", async () => {
    const { engine } = mk();
    const u = "encaje_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "49" }, { content: "es demasiado?" }]
    });

    const lower = res.response.toLowerCase();
    // No afirma el encaje/aceptacion por su cuenta (invariante 4).
    expect(lower).not.toMatch(/nos encaja|te encaja|estas dentro/);
    // Pero SI tranquiliza sobre la edad (no la deja colgada).
    expect(lower).toMatch(/perfecto|maduro|por la edad/);
    expect(res.response.trim().length).toBeGreaterThan(0);
  });
});
