import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Fase 2 (Alex 6-jul, esere.md): los turnos de cualificacion dejan de usar la plantilla determinista fija
// (useDeterministicQuestionTurn) y pasan por el LLM (gpt-5.4) para que REACCIONE a su situacion e INDAGUE
// con naturalidad, en vez de disparar la pregunta de guion como un robot. RED estructural: un guard
// post-borrador rescata la pregunta del guion SOLO si el borrador se quedo sin NINGUNA pregunta (para no
// estancar el funnel). Si el LLM ya pregunto algo (indaga sobre su situacion), se respeta y NO se duplica.
// En modo determinista (sin drafter, el resto de la suite) NADA cambia: draftResponse devuelve el mismo
// deterministicResponse (que ya trae la pregunta), asi que el guard no dispara.

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

async function seedQualifyingMissingDevice(repository: InMemoryCandidateRepository, username: string) {
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

describe("Cualificacion viva: el LLM redacta el turno y el guard rescata la pregunta (Alex 6-jul)", () => {
  it("el turno de cualificacion pasa por el LLM (ya no plantilla fija); si el borrador no pregunta, el guard anade la del guion", async () => {
    const { engine, repository } = engineWith(fakeDrafter("me alegro un monton de leerte"));
    const c = await seedQualifyingMissingDevice(repository, "qv_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale genial" }]
    });
    // El borrador del LLM se USO (ya no la plantilla determinista): su texto distintivo aparece.
    expect(r.response.toLowerCase()).toContain("me alegro un monton");
    // Y el guard rescato la pregunta pendiente del guion (el movil), para no estancar el funnel.
    expect(r.response).toContain("?");
    expect(r.response.toLowerCase()).toMatch(/movil|telefono|celular/);
  });

  it("si el LLM INDAGA con su propia pregunta ('?'), se respeta y NO se duplica con la del guion", async () => {
    const { engine, repository } = engineWith(fakeDrafter("entiendo, cuentame un poco mas, que estas buscando?"));
    const c = await seedQualifyingMissingDevice(repository, "qd_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "ah ok" }]
    });
    // La pregunta con la que INDAGA el LLM se conserva.
    expect(r.response.toLowerCase()).toContain("cuentame");
    // Y NO se anade una segunda pregunta del guion (una sola '?').
    expect((r.response.match(/\?/g) || []).length).toBe(1);
  });
});
