import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug real (Natalia, 7-jul): a un mensaje vago sobre el movil, la IA respondio "sisi pero necesito saber el
// movil exacto / Dime la marca y el modelo, por ejemplo iPhone 13 o Samsung S23" (una pregunta imperativa SIN
// "?"). El guard "qualifying-question-rescue" creyo que no se habia preguntado y ANADIO la pregunta del movil
// completa -> el movil se preguntaba 2-3 veces en el turno, y ademas marcaba el turno como "sin IA (fallback)"
// aunque la IA SI habia redactado. Fix: (1) reconocer el imperativo como pregunta; (2) traza honesta.

function fakeDrafter(text: string): ResponseDraftingProvider {
  return {
    async draft() {
      return ResponseDraftOutputSchema.parse({
        response: text,
        provider: "openai",
        modelVersion: "gpt-5.4",
        promptVersion: "t",
        requestedProvider: "OPENAI",
        actualProvider: "openai",
        requestedModel: "gpt-5.4",
        actualModel: "gpt-5.4",
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

async function seedPreDevice(repository: InMemoryCandidateRepository, username: string) {
  // Nombre y edad ya sabidos, movil DESCONOCIDO -> la pregunta pendiente del guion es la del movil.
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Natalia",
      age: 39,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

const LLM_ASKS_MOVIL =
  "sisi pero necesito saber el movil exacto\n\nDime la marca y el modelo, por ejemplo iPhone 13 o Samsung S23";

describe("El rescate de pregunta NO duplica el movil si el LLM ya lo pidio (bug Natalia 7-jul)", () => {
  it("si el LLM ya pide el movil de forma imperativa (sin '?'), NO se re-adjunta la pregunta del guion", async () => {
    const { engine, repository } = engineWith(fakeDrafter(LLM_ASKS_MOVIL));
    const c = await seedPreDevice(repository, "nat_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "las fotos las puedo hacer de calidad, no habria problema con eso" }]
    });
    // NO aparece la pregunta del guion anadida (su frase unica es "modelo de movil tienes exactamente").
    expect(r.response).not.toMatch(/modelo de movil tienes exactamente/i);
    // El movil se pide UNA sola vez (la del LLM), no 2-3 veces.
    expect((r.response.match(/marca y el modelo/gi) ?? []).length).toBe(1);
    // Traza honesta: la IA redacto -> NO es "sin IA".
    expect(r.draft.usedFallback).toBe(false);
  });

  it("(control) si el LLM NO pregunta nada, el rescate SI anade la pregunta del guion (y sin mentir en la traza)", async () => {
    const { engine, repository } = engineWith(fakeDrafter("vale, entiendo"));
    const c = await seedPreDevice(repository, "nat_ctrl_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "las fotos las puedo hacer de calidad, no habria problema con eso" }]
    });
    // El rescate mete la pregunta del movil (el funnel no se estanca).
    expect(r.response.toLowerCase()).toMatch(/movil|marca|modelo/);
    // Pero como la IA SI escribio la base, la traza NO miente: no es fallback.
    expect(r.draft.usedFallback).toBe(false);
  });

  it("(traza) si el borrador queda SIN texto, se sustituye por la pregunta y SI se marca fallback (honesto)", async () => {
    const { engine, repository } = engineWith(fakeDrafter(""));
    const c = await seedPreDevice(repository, "nat_empty_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "las fotos las puedo hacer de calidad, no habria problema con eso" }]
    });
    // Sin texto del LLM, el turno se cubre con la pregunta del guion (determinista) -> es honesto marcar fallback.
    expect(r.response.toLowerCase()).toMatch(/movil|marca|modelo/);
    expect(r.draft.usedFallback).toBe(true);
  });
});
