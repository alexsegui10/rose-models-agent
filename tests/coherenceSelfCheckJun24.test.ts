import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ResponseDraftOutputSchema, type ResponseDraftingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// PASO 4 (Alex 24-jun): self-check determinista de coherencia. Si el plan PODIA responder (answerFacts, sin
// escalada) pero el borrador DERIVA al socio sin necesidad o queda vacio, se reescribe desde el plan para
// atender de verdad. Solo actua ante esos fallos claros (no degrada respuestas buenas: control en el 2o test).

function deferringDrafter(text: string): ResponseDraftingProvider {
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

const DEFER = "Uy eso lo hablo con mi socio y te digo.";
const DEFER_RX = /lo hablo con mi socio|lo comento con mi socio|con mi socio y te digo/i;

describe("Paso 4: self-check de coherencia (no derivar al socio si el plan puede responder)", () => {
  it("borrador que DERIVA al socio pero el plan tiene la respuesta -> responde desde el plan", async () => {
    const { engine, repository } = engineWith(deferringDrafter(DEFER));
    const seeded = await seedQualifying(repository, "csc1");

    const r = await engine.handleIncomingTurn({
      instagramUsername: seeded.instagramUsername,
      messages: [{ content: "que hace la agencia exactamente?" }]
    });

    // Hay conocimiento de servicios (answerFacts) y no es escalada: NO debe derivar, debe responder.
    expect(r.response.toLowerCase()).not.toMatch(DEFER_RX);
    expect(r.response.trim().length).toBeGreaterThan(0);
  });

  it("CONTROL: si el borrador YA responde bien (no deriva), el self-check NO lo toca (no hay falso rechazo)", async () => {
    const goodAnswer = "Pues mira, nosotros generamos el trafico y gestionamos todo, tu solo subes el contenido.";
    const { engine, repository } = engineWith(deferringDrafter(goodAnswer));
    const seeded = await seedQualifying(repository, "csc2");

    const r = await engine.handleIncomingTurn({
      instagramUsername: seeded.instagramUsername,
      messages: [{ content: "que hace la agencia exactamente?" }]
    });

    // El borrador responde (no deriva ni queda vacio): el self-check es inerte, se respeta la respuesta.
    expect(r.response).toContain("generamos el trafico");
  });
});
