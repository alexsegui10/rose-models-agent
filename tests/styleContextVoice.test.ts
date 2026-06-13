import { describe, expect, it } from "vitest";
import { buildStyleContext } from "@/application/styleContextBuilder";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";
import { createCandidate, type Candidate } from "@/domain/candidate";

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

function contextFor(candidate: Candidate, understanding = understandingWith()) {
  const responsePlan = buildResponsePlan({
    candidate,
    understanding,
    inboundMessage: "Hola",
    knowledgeEntries: []
  });
  return buildStyleContext({
    candidate,
    understanding,
    recentMessages: [],
    retrievedExamples: [],
    knowledgeEntries: [],
    responsePlan,
    allowedActions: [],
    forbiddenActions: [],
    immediateObjective: "Avanzar"
  }).context;
}

describe("styleContext surfaces the known name (mata el reset de funnel y la plantilla de rechazo de nombre)", () => {
  // replay-14 T9 / replay-15 T12 (funnel reset re-asking the name) y replay-11 T2 / replay-12 T2
  // (plantilla inventada 'Si no quieres darme el nombre'): el modelo re-preguntaba el nombre porque
  // STRUCTURED_MEMORY nunca se lo daba. El nombre conocido DEBE viajar en el contexto.
  it("includes the candidate firstName in STRUCTURED_MEMORY when it is known", () => {
    const candidate: Candidate = {
      ...createCandidate({ instagramUsername: "voz_nombre", profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING",
      firstName: "Carla"
    };
    const context = contextFor(candidate);
    expect(context).toContain("Carla");
    expect(context).toMatch(/"firstName": ?"Carla"/);
  });

  it("marks firstName as null when it is still unknown (no inventes un nombre)", () => {
    const candidate: Candidate = {
      ...createCandidate({ instagramUsername: "voz_sin_nombre", profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING"
    };
    const context = contextFor(candidate);
    expect(context).toMatch(/"firstName": ?null/);
  });
});

describe("styleContext surfaces Alex's live-typing identity (voz: tipeo en vivo, registro dual)", () => {
  // El juez: la voz lee 'demasiado pulida' porque los typos habituales y el doble registro viven en
  // el perfil pero nunca llegaban al prompt. Deben surfacearse para recuperar la textura en vivo.
  it("includes the habitual typos block so the live register keeps Alex's texture", () => {
    const candidate: Candidate = {
      ...createCandidate({ instagramUsername: "voz_typos", profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING"
    };
    const context = contextFor(candidate);
    expect(context.toLowerCase()).toContain("trabjamos");
    expect(context.toLowerCase()).toContain("okeyy");
  });

  it("includes the dual-register guidance (vivo informal vs plantilla pulida)", () => {
    const candidate: Candidate = {
      ...createCandidate({ instagramUsername: "voz_registro", profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING"
    };
    const context = contextFor(candidate);
    expect(context.toLowerCase()).toMatch(/registro|vivo/);
    expect(context.toLowerCase()).toContain("una idea por mensaje");
  });
});
