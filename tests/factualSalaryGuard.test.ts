import { describe, expect, it } from "vitest";
import { validateFactualResponse } from "@/application/factualValidator";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";
import { createCandidate, type Candidate } from "@/domain/candidate";

// Regresion (analisis de conversaciones reales 19-jun): el bot NUNCA debe soltar un importe de pago/salario
// de forma proactiva (los detalles de pago van a la llamada; el % solo si preguntan la cifra exacta). El
// guard de porcentajes no cazaba un importe pelado tipo "400usd" o "600 euros" sin la palabra "garantizado",
// justo donde Alex respondio mal en la realidad. Este guard cierra ese agujero.

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

function planFor(inbound: string) {
  const candidate: Candidate = {
    ...createCandidate({ instagramUsername: "salary_guard", profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING"
  };
  return buildResponsePlan({
    candidate,
    understanding: understandingWith({ intent: "REQUESTS_INFORMATION" }),
    inboundMessage: inbound,
    knowledgeEntries: []
  });
}

describe("Validador factual: guard de importes de salario/pago", () => {
  const plan = planFor("cuanto ofrecen? me pagan algo al mes?");

  it.each([
    "Te ofrecemos 400usd al mes para empezar.",
    "Puedes ganar unos 800 USD al mes.",
    "El salario es de 600 euros.",
    "Son 500 dólares fijos.",
    "Te damos $500 de entrada.",
    "Pagamos 600€ al mes."
  ])("BLOQUEA un importe de pago proactivo: %s", (response) => {
    const result = validateFactualResponse(response, plan);
    expect(result.valid).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/importe|pago|salario/i);
  });

  it("PERMITE una respuesta que deriva el pago a la llamada (sin cifras)", () => {
    const result = validateFactualResponse(
      "Los detalles de pago te los explico mejor en la llamada, trabajamos por porcentaje.",
      plan
    );
    expect(result.valid).toBe(true);
  });

  it("no confunde un modelo de movil con un importe (iPhone 13 no es dinero)", () => {
    const result = validateFactualResponse("Perfecto, con un iPhone 13 vamos bien.", plan);
    expect(result.valid).toBe(true);
  });
});
