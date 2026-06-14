import { describe, expect, it } from "vitest";
import { validateFactualResponse } from "@/application/factualValidator";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, type Candidate } from "@/domain/candidate";

function understandingWith(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "REQUESTS_INFORMATION",
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

function planForFaceObjection() {
  const candidate: Candidate = {
    ...createCandidate({ instagramUsername: "face_guard", profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING"
  };
  return buildResponsePlan({
    candidate,
    understanding: understandingWith(),
    inboundMessage: "Puedo trabajar sin mostrar la cara? No quiero que se me vea la cara",
    knowledgeEntries: [entryById("face-requirement-mandatory")]
  });
}

// replay-4 T12: el bot prometio 'podemos trabajar la cuenta para que no salga tu cara', contradiciendo
// la politica innegociable 'la cara es imprescindible'. El validador factual hacia substring del texto
// completo del prohibitedClaim ('Prometer difuminar, tapar o recortar la cara como alternativa') y por
// eso nunca cazaba la promesa real. Esta es la violacion de mayor severidad de la iteracion 1.

describe("factual guard: never promise hiding the face (replay-4 T12)", () => {
  it("rejects a response that promises the face will not show", () => {
    const plan = planForFaceObjection();
    const validation = validateFactualResponse("No te preocupes, podemos trabajar la cuenta para que no salga tu cara.", plan);
    expect(validation.valid).toBe(false);
  });

  it("rejects a response offering anonymous work", () => {
    const plan = planForFaceObjection();
    const validation = validateFactualResponse("Si quieres puedes trabajar en anonimato sin ensenar la cara.", plan);
    expect(validation.valid).toBe(false);
  });

  it("rejects a response promising to blur or cover the face", () => {
    const plan = planForFaceObjection();
    const validation = validateFactualResponse("Podemos difuminar tu cara en los videos si lo prefieres.", plan);
    expect(validation.valid).toBe(false);
  });

  it("rejects a long formulation that hides the face with 'sin que aparezca ... la cara'", () => {
    const plan = planForFaceObjection();
    const validation = validateFactualResponse(
      "Podemos crear una estrategia donde trabajamos el contenido sobre otras tematicas del cuerpo y movimientos sin que aparezca de manera evidente la cara.",
      plan
    );
    expect(validation.valid).toBe(false);
  });

  it("accepts the canonical 'la cara es imprescindible' answer", () => {
    const plan = planForFaceObjection();
    const validation = validateFactualResponse(
      "Entiendo\n\nLa cara es imprescindible para nuestra estrategia, da mucha mas confianza al cliente.",
      plan
    );
    expect(validation.valid).toBe(true);
  });

  it("does not flag face talk when the face policy is not in play", () => {
    const candidate: Candidate = {
      ...createCandidate({ instagramUsername: "no_face_plan", profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING"
    };
    const plan = buildResponsePlan({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Que movil necesito?",
      knowledgeEntries: []
    });
    const validation = validateFactualResponse("Perfecto, con un iPhone reciente vamos bien.", plan);
    expect(validation.valid).toBe(true);
  });
});
