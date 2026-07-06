import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug real (Julia, 6-jul): a "No / Tengo cuenta solo" el bot solto "Okeyy, al tener dos cuentas puedes
// trabjar con dos agencias pero no puede ser del mismo trafico" de la nada (ella no trabaja con otra
// agencia). La ficha de multi-agencia NO se recita salvo que la candidata trabaje con otra agencia o lo
// haya sacado. Si SI trabaja con otra, la ficha sigue disponible.

const MULTI = "Okeyy, al tener dos cuentas puedes trabjar con dos agencias pero no puede ser del mismo trafico";

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

async function seed(repository: InMemoryCandidateRepository, username: string, works?: boolean) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Julia",
      age: 43,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: works,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("No recitar multi-agencia de la nada (bug Julia 6-jul)", () => {
  it("si NO trabaja con otra agencia y no lo saca, el bot NO suelta 'dos cuentas / dos agencias'", async () => {
    const { engine, repository } = engineWith(fakeDrafter(MULTI));
    const c = await seed(repository, "ma_no_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "no, tengo cuenta solo" }]
    });
    expect(r.response.toLowerCase()).not.toMatch(/dos cuentas|dos agencias|del mismo trafico/);
  });

  it("si SI trabaja con otra agencia, la ficha de multi-agencia SIGUE disponible", async () => {
    const { engine, repository } = engineWith(fakeDrafter(MULTI));
    const c = await seed(repository, "ma_si_" + Math.random().toString().slice(2, 6), true);
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "si, trabajo con otra agencia tambien" }]
    });
    expect(r.response.toLowerCase()).toMatch(/dos agencias|dos cuentas/);
  });
});
