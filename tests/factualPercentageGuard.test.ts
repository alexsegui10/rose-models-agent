import { describe, expect, it } from "vitest";
import { validateFactualResponse } from "@/application/factualValidator";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, type Candidate } from "@/domain/candidate";

// Invariante 3 (ultima linea de defensa): el validador factual debe bloquear un porcentaje que el PLAN
// no autorizo este turno (mencion proactiva o cifra alucinada por OpenAI fuera de answerFacts), y dejar
// pasar el 70/30 cuando la candidata pidio la cifra exacta. Antes esta guarda estaba inerte.

function understandingWith(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
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

function entryById(id: string) {
  const entry = businessKnowledgeEntries.find((item) => item.id === id);
  if (!entry) throw new Error(`Knowledge entry ${id} not found`);
  return entry;
}

function candidate(): Candidate {
  return { ...createCandidate({ instagramUsername: "pct_guard", profileVisibility: "PUBLIC" }), currentState: "QUALIFYING" };
}

describe("Validador factual: guard de porcentaje dependiente del plan", () => {
  it("BLOQUEA un 70/30 proactivo cuando el plan no autoriza la cifra (no pregunto la cifra exacta)", () => {
    const plan = buildResponsePlan({
      candidate: candidate(),
      understanding: understandingWith({ intent: "CONFIRMS_INTEREST" }),
      inboundMessage: "vale me interesa",
      knowledgeEntries: []
    });
    const result = validateFactualResponse("Trabajamos 70% para la agencia y 30% para ti.", plan);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/porcentaje/i);
  });

  it("PERMITE el 70/30 cuando la candidata pidio la cifra exacta (el plan lo autoriza)", () => {
    const plan = buildResponsePlan({
      candidate: candidate(),
      understanding: understandingWith({ intent: "ASKS_ABOUT_PERCENTAGE" }),
      inboundMessage: "cual es el reparto exacto? cuanto os quedais vosotros?",
      knowledgeEntries: [entryById("commercial-revenue-share-general")]
    });
    // Sanity: el plan trae la cifra en sus facts/allowedClaims.
    const planHasFigure = [...plan.answerFacts, ...plan.allowedClaims].some((fact) => /70|30/.test(fact));
    expect(planHasFigure).toBe(true);

    const result = validateFactualResponse("El reparto estandar es 70% para la agencia y 30% para ti.", plan);
    expect(result.valid).toBe(true);
  });
});
