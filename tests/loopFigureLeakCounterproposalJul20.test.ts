import { describe, expect, it } from "vitest";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop iteracion 4 (sonda de bordes, invariante 3): la exclusion "si el mensaje menciona 70/30 no es
// negociacion" miraba el mensaje ENTERO. Asi, "lo del 70/30 me parece un monton, haceme 85/15" daba la
// cifra porque el "70/30" propio de la agencia aparecia en la frase, aunque ella estuviera CONTRAPROPONIENDO
// otro reparto (85/15). Fix: cada split se evalua por separado (85/15 escala aunque 70/30 tambien aparezca),
// y una objecion al 70/30 ("es un abuso/robo/afano/un monton") tambien escala. La pregunta legitima de la
// cifra ("como es lo del 70/30", "de cuanto es el reparto") SIGUE dando la cifra: sin contrapropuesta ni
// objecion no hay negociacion. Regla de negocio de Alex (20-jul): el % NO se negocia en el chat, se
// negocia en la llamada -> en el chat, negociar SIEMPRE escala a revision humana, jamas suelta otra cifra.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "fig_" + Math.random().toString().slice(2, 6) }),
    currentState: "QUALIFYING" as CandidateState
  } as unknown as Candidate);
}

function givesFigure(message: string): boolean {
  const understanding = ModelConversationOutputSchema.parse({
    intent: "ASKS_ABOUT_PERCENTAGE",
    extractedData: {},
    confidence: 0.9,
    moneyTopic: "NONE",
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: ""
  });
  const plan = buildResponsePlan({
    candidate: candidate(),
    understanding,
    inboundMessage: message,
    knowledgeEntries: [],
    hasApprovedNegotiationDecision: false,
    recentAgentMessages: [],
    isOpenerTurn: false
  });
  return plan.answerFacts.some((f) => /\b70\s?%|30\s?%|70\/30\b/.test(f));
}

describe("Invariante 3: contrapropuesta u objecion al 70/30 NO suelta la cifra (se negocia en la llamada)", () => {
  const mustEscalate = [
    "lo del 70/30 me parece un monton, haceme 85/15 y firmo hoy",
    "el 70/30 me parece un monton",
    "el 70/30 es un abuso",
    "el 70/30 es un robo",
    "el 70/30 es un afano",
    "quiero 85/15",
    "40/60 se puede?",
    "haceme 60/40 dale",
    "el 70 30 es mucho para ustedes"
  ];
  for (const m of mustEscalate) {
    it(`'${m}' NO da la cifra (escala: negociacion)`, () => {
      expect(givesFigure(m), m).toBe(false);
    });
  }

  const mustGiveFigure = [
    "en el 70/30 quien se queda cada parte?",
    "de cuanto es el reparto?",
    "cuanto me toca a mi?",
    "de cuanto seria la parte de la agencia?",
    "cual es el porcentaje?",
    "como es lo del 70/30?"
  ];
  for (const m of mustGiveFigure) {
    it(`'${m}' SÍ da la cifra (pregunta legitima, sin contrapropuesta)`, () => {
      expect(givesFigure(m), m).toBe(true);
    });
  }
});
