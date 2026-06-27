import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// QA sweep 26-jun: ante "trabajan con Fansly?" el LLM redacto "Si, trabajamos tambien con Fansly" (INVENTADO: la
// agencia solo gestiona OnlyFans). GUARDA: si la candidata pregunta por una plataforma competidora y el borrador
// la menciona, se reescribe a la verdad ("trabajamos con OnlyFans"). El bot NUNCA debe afirmar otra plataforma.

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

async function seedAdult(repository: InMemoryCandidateRepository, username: string) {
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

describe("El bot nunca afirma una plataforma que no sea OnlyFans (Alex 26-jun, QA sweep)", () => {
  it("aunque el borrador alucine 'trabajamos con Fansly', la respuesta NO afirma Fansly", async () => {
    for (const msg of ["trabajan con la plataforma Fansly?", "usais Fansly o ManyVids?", "y con Chaturbate trabajan?"]) {
      const { engine, repository } = engineWith(fakeDrafter("Si, trabajamos tambien con Fansly y ManyVids, pagamos genial"));
      const c = await seedAdult(repository, "plat_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.response.toLowerCase(), `"${msg}"`).not.toMatch(/fansly|manyvids|chaturbate/);
    }
  });

  // Panel prod 27-jun: en produccion el LLM AFIRMABA sin nombrar la plataforma ("Tambien, si..." y se iba a
  // Telegram/Twitter), asi que la guarda (que exigia que el borrador NOMBRARA la plataforma) no saltaba. Ahora
  // salta ante la PREGUNTA por otra plataforma, salvo que la respuesta ya aclare "solo OnlyFans / no otras".
  it("si afirma sin nombrar la plataforma ('Tambien, si...'), la respuesta se corrige a OnlyFans", async () => {
    const { engine, repository } = engineWith(fakeDrafter("Tambien, si Nosotros movemos trafico por Telegram y Twitter tambien"));
    const c = await seedAdult(repository, "plat_aff_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "trabajan con fansly tambien?" }]
    });
    expect(r.response.toLowerCase()).toMatch(/onlyfans, no con otras plataformas/);
    expect(r.response.toLowerCase()).not.toMatch(/tambien, si|telegram/);
  });

  it("una pregunta SIN plataforma competidora no se reescribe", async () => {
    const { engine, repository } = engineWith(fakeDrafter("Se gana bien, depende mucho de tu constancia"));
    const c = await seedAdult(repository, "plat_no_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "cuanto se gana?" }]
    });
    expect(r.response.toLowerCase()).not.toMatch(/no con otras plataformas/);
  });
});
