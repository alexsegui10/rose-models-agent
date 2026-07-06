import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regla de Alex (6-jul): TODAS las candidatas son de Argentina, asi que el bot NUNCA pregunta de que pais
// o de donde es. El modelo a veces la cuelga para rellenar (visto en la sim de Rocio). Guard determinista:
// se quita esa pregunta aunque el modelo la cuele.

function fakeDrafter(text: string): ResponseDraftingProvider {
  return {
    async draft() {
      return ResponseDraftOutputSchema.parse({
        response: text,
        provider: "test",
        modelVersion: "t",
        promptVersion: "t",
        requestedProvider: "TEST",
        actualProvider: "test",
        requestedModel: "t",
        actualModel: "t",
        usedFallback: false,
        fallbackReason: null,
        durationMs: 1,
        retryCount: 0,
        inputTokens: null,
        outputTokens: null,
        estimatedCostUsd: null
      });
    }
  };
}

function engineWith(drafter: ResponseDraftingProvider) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    draftingProvider: drafter,
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

async function seedQualifying(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("El bot NUNCA pregunta el pais (todas son de Argentina, Alex 6-jul)", () => {
  it("aunque el borrador cuelgue '¿de que pais eres?', la respuesta final NO lo pregunta", async () => {
    const { engine, repository } = engineWith(
      fakeDrafter("Te entiendo, para eso estamos nosotros\n\nPor cierto, de que pais eres?")
    );
    const c = await seedQualifying(repository, "pais_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "es mucho hacerlo sola la verdad" }]
    });
    const lower = r.response.toLowerCase();
    expect(lower).not.toMatch(/de que pais|de donde (?:eres|sos)|pais eres/);
    // Y se conserva lo bueno (la empatia).
    expect(lower).toContain("te entiendo");
  });

  it("'de donde sos?' tambien se quita", async () => {
    const { engine, repository } = engineWith(fakeDrafter("Genial\n\nY de donde sos?"));
    const c = await seedQualifying(repository, "sos_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale" }]
    });
    expect(r.response.toLowerCase()).not.toMatch(/de donde sos|de que pais/);
    expect(r.response.trim().length).toBeGreaterThan(0);
  });

  // El origen del "de que pais eres?" era un SLOT del plan (responsePlanner). Ahora isMissing=false: el plan
  // JAMAS lo pide, ni siquiera como slot tardio, ni en el fallback determinista. Recorre el guion entero.
  it("el plan NUNCA pide el pais como slot, en ningun turno del guion (determinista, sin pais conocido)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const u = "slot_" + Math.random().toString().slice(2, 6);
    const guion = [
      "hola",
      "me llamo ana",
      "31",
      "iphone 14",
      "si tengo of hace un ano",
      "no, nunca con agencia",
      "vale genial",
      "ok perfecto"
    ];
    for (const msg of guion) {
      const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `turno "${msg}"`).not.toMatch(/de que pais|de donde (?:eres|sos)|pais eres/);
    }
  });
});
