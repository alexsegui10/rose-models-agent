import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ModelConversationOutputSchema, type ConversationUnderstandingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug grave flaky (Alex 23-jun): la candidata YA dio el movil (iPhone 14, APPROVED) y, al contestar OnlyFans
// ("No nunca, es la primera"), el bot le RE-PREGUNTO el movil ("¿que modelo exactamente?") + escalo. Causa: en
// ese turno el LLM "olvido"/vacio el movil ya guardado y el slot volvia a parecer "missing". HECHOS PEGAJOSOS:
// un dato del movil ya contestado NUNCA se des-contesta por una re-inferencia del LLM, y el planner nunca
// re-pregunta un movil ya conocido. Un cambio REAL de movil si se aplica.

async function seedApprovedDevice(repository: InMemoryCandidateRepository) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `dev_${Math.random()}`, profileVisibility: "PUBLIC" }),
      firstName: "Laura",
      age: 22,
      isAdultConfirmed: true,
      deviceType: "IPHONE",
      deviceModel: "Iphone 14",
      deviceEligibility: "APPROVED",
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Hechos pegajosos del movil: nunca re-preguntar un movil ya contestado (Alex 23-jun)", () => {
  it("el LLM 'olvida' el movil (deviceModel='' + UNKNOWN) al contestar OF -> el movil NO se re-pregunta y queda intacto", async () => {
    const repository = new InMemoryCandidateRepository();
    // Stub que simula la fuga del LLM: responde OF=false PERO vacia el movil ya guardado.
    const provider: ConversationUnderstandingProvider = {
      async understand() {
        return ModelConversationOutputSchema.parse({
          intent: "OTHER",
          confidence: 0.6,
          suggestedStateTransition: null,
          requiresHumanReview: false,
          humanReviewReason: null,
          response: "",
          extractedData: { deviceModel: "", deviceEligibility: "UNKNOWN", hasOnlyFans: false }
        });
      }
    };
    const engine = new ConversationEngine({
      repository,
      understandingProvider: provider,
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const c = await seedApprovedDevice(repository);

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "No nunca, es la primera" }]
    });

    // El movil ya contestado NO se pierde ni se re-pregunta.
    expect(r.candidate.deviceModel).toBe("Iphone 14");
    expect(r.candidate.deviceEligibility).toBe("APPROVED");
    expect(r.response.toLowerCase()).not.toMatch(/que movil tienes|modelo de movil|marca y .*modelo/);
  });

  it("un CAMBIO real de movil SI se aplica (los hechos pegajosos no bloquean cambios legitimos)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const c = await seedApprovedDevice(repository);

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "ah espera, ahora tengo un iphone 15" }]
    });

    expect(r.candidate.deviceModel?.toLowerCase()).toContain("15");
    expect(r.candidate.deviceEligibility).toBe("APPROVED");
  });
});
