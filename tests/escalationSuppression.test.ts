import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput
} from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function stubUnderstanding(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData: {},
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
}

function createEngineWithStub(outputs: ModelConversationOutput[]) {
  const repository = new InMemoryCandidateRepository();
  let callIndex = 0;
  const provider: ConversationUnderstandingProvider = {
    async understand() {
      const output = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      if (!output) throw new Error("Stub understanding output missing");
      return output;
    }
  };
  const engine = new ConversationEngine({ repository, understandingProvider: provider });
  return { engine, repository };
}

describe("escalation suppression allowlist (regresion de seguridad: solo se suprimen motivos benignos)", () => {
  it("keeps the coercion escalation when a third party controls the conversation", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: "Posible coaccion: un tercero controla la conversacion"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_coaccion",
      profileVisibility: "PUBLIC",
      message: "mi novio gestiona mis cuentas"
    });

    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("keeps the age-doubt escalation even when a clean adult age is extracted alongside the doubt", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "PROVIDES_AGE",
        extractedData: { age: 19 },
        requiresHumanReview: true,
        humanReviewReason: "Edad dudosa: afirma 19 pero dice que parece de 15"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_19_parece_15",
      profileVisibility: "PUBLIC",
      message: "tengo 19 jajaja aunque todos dicen que parezco de 15"
    });

    // Invariante 2: la duda de edad nunca se neutraliza en silencio, Alex tiene que verla.
    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.understanding.humanReviewReason).toContain("Edad dudosa");
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("keeps model escalations whose safety wording is outside the local lexicon", async () => {
    const reasons = [
      "Candidate seems underage",
      "Could be a minor, needs review",
      "Parece muy joven para el proceso",
      "Suena adolescente, mejor revisar",
      "Dice que todavia va al instituto"
    ];

    for (const humanReviewReason of reasons) {
      const { engine } = createEngineWithStub([
        stubUnderstanding({
          intent: "OTHER",
          extractedData: {},
          requiresHumanReview: true,
          humanReviewReason
        })
      ]);

      const result = await engine.handleIncomingMessage({
        instagramUsername: "lead_lexico_desconocido",
        profileVisibility: "PUBLIC",
        message: "ok pues"
      });

      expect(result.understanding.requiresHumanReview, humanReviewReason).toBe(true);
      expect(result.candidate.currentState, humanReviewReason).toBe("HUMAN_INTERVENTION_REQUIRED");
    }
  });

  it("records a suppressed benign escalation in the candidate notes instead of dropping it silently", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: { deviceType: "IPHONE", deviceModel: "iphone 13 pro max", deviceEligibility: "APPROVED" },
        requiresHumanReview: true,
        humanReviewReason: "Hay que validar el movil"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_iphone_traza",
      profileVisibility: "PUBLIC",
      message: "Tengo un iPhone 13 Pro Max"
    });

    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.candidate.notes).toContain("ESCALADA_SUPRIMIDA: Hay que validar el movil");
  });

  it("keeps an escalation without any stated reason (ambiguous is never benign)", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: null
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_sin_motivo",
      profileVisibility: "PUBLIC",
      message: "ok"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});
