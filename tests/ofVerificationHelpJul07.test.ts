import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug real (Paula, 7-jul): a "tengo la cuenta abierta pero nunca la pude validar / nose porque" el bot
// empatizo y en el MISMO turno le solto "La cuenta la abres tu y es bastante facil, solo sigues los pasos
// que te indican, enlazas tu cuenta de banco y te verificas" -> la CONTRADICE (ella dijo que NO pudo) y le
// quita importancia a su problema. El paso a paso del onboarding NO se recita cuando cuenta un PROBLEMA para
// verificar/activar; ahi se la tranquiliza con que la agencia la ayuda. Cuando PREGUNTA como/quien abre, el
// onboarding sigue disponible.

const PAULA_BOT = [
  "Nose, a veces pasa con la verificacion de OF",
  "La cuenta la abres tu y es bastante facil, solo sigues los pasos que te indican, enlazas tu cuenta de banco y te verificas",
  "Cuanto tiempo le podrias dedicar a esto a la semana?"
].join("\n\n");

const ONBOARDING = [
  "La cuenta de OnlyFans la abres tu, es muy facil",
  "Solo creas la cuenta con los pasos que te indican, enlazas tu cuenta de banco y te verificas"
].join("\n\n");

const ONBOARDING_RX = /la abres tu|pasos que te indican|enlazas tu cuenta de banco|te verificas/i;

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

async function seed(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Paula",
      age: 29,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Problema para verificar OF: no recitar el onboarding (bug Paula 7-jul)", () => {
  it("si cuenta que NO PUDO validar la cuenta, el bot NO le suelta 'la abres tu / sigues los pasos / enlazas el banco'", async () => {
    const { engine, repository } = engineWith(fakeDrafter(PAULA_BOT));
    const c = await seed(repository, "pa_prob_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "no, tengo la cuenta abierta pero nunca la pude validar" }, { content: "nose porque" }]
    });
    expect(r.response).not.toMatch(ONBOARDING_RX);
    // No la deja muda: conserva la empatia o la pregunta del guion.
    expect(r.response.trim().length).toBeGreaterThan(0);
  });

  it("si PREGUNTA como/quien abre la cuenta (no es un problema), el onboarding SIGUE disponible", async () => {
    const { engine, repository } = engineWith(fakeDrafter(ONBOARDING));
    const c = await seed(repository, "pa_ask_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "y como abro la cuenta de onlyfans? la abro yo o vosotros?" }]
    });
    expect(r.response).toMatch(ONBOARDING_RX);
  });

  it("NO sobre-dispara con una excusa de tiempo ('no la puedo usar porque no tengo tiempo')", async () => {
    const { engine, repository } = engineWith(fakeDrafter(ONBOARDING));
    const c = await seed(repository, "pa_time_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "la tengo pero no la puedo usar porque no tengo tiempo" }]
    });
    // No es un problema de verificacion: el candado NO debe suprimir el onboarding por su cuenta.
    expect(r.response).toMatch(ONBOARDING_RX);
  });
});
