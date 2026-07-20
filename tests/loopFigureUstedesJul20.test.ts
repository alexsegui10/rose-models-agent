import { describe, expect, it } from "vitest";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Barrido de conversación 20-jul (persona "apurada", caso Daniela): pregunta la CIFRA exacta con fraseos que el
// detector no cubría — "el porcentaje CUÁNTO ES?" (orden invertido) y "cuánto se quedan USTEDES y cuánto queda
// para mí?" (forma "ustedes", no "os quedáis") — así que NO recibía el 70/30 y el bot repetía 4 veces "va por
// reparto, en la llamada" (el bucle que Alex odia). Por invariante 3, a quien pregunta la cifra exacta se le da
// el 70/30. AÑADIDO al detector determinista (invariante 1: el % lo decide el CÓDIGO). La NEGOCIACIÓN/OBJECIÓN con
// el mismo léxico sigue SIN soltar la cifra (la veta isCommercialEscalation): eso es lo que verifica este test.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "fu_" + Math.random().toString().slice(2, 6) }),
    age: 36,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
  } as unknown as Candidate);
}

function givesFigure(message: string, intent = "ASKS_ABOUT_PERCENTAGE"): boolean {
  const understanding = ModelConversationOutputSchema.parse({
    intent,
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
  return plan.answerFacts.some((f) => /70\s?%|30\s?%|70\/30/.test(f));
}

describe("Invariante 3: preguntas de cifra 'el porcentaje cuánto es' / 'cuánto se quedan ustedes' dan 70/30", () => {
  const mustGiveFigure = [
    "el porcentaje cuanto es? quiero saber eso ya",
    "cuanto se quedan ustedes y cuanto queda para mi, al grano",
    "cuanto se quedan ustedes?",
    "el porcentaje cuanto sale?",
    "cuanto se llevan ustedes de lo que genero?"
  ];
  for (const m of mustGiveFigure) {
    it(`'${m}' SÍ da la cifra (pregunta de cifra exacta)`, () => {
      expect(givesFigure(m), m).toBe(true);
    });
  }

  // NEGOCIACIÓN/OBJECIÓN con el MISMO léxico: NO suelta la cifra (la veta isCommercialEscalation -> escala).
  // La familia "menos / no sea tanto / ojala poco" la cazó el revisor 20-jul (fuga que introduje) -> añadida al veto.
  const mustNotGiveFigure = [
    "es un abuso cuanto se quedan ustedes",
    "me parece un monton lo que se quedan ustedes",
    "cuanto se quedan ustedes? porque si es mucho quiero 60 para mi",
    "el porcentaje me parece bajo, quiero mas para mi",
    "cuanto se quedan ustedes menos",
    "cuanto se quedan ustedes? deberia ser menos",
    "cuanto se quedan ustedes? tendria que ser menos",
    "cuanto se quedan ustedes? no quiero que sea tanto",
    "cuanto se quedan ustedes? ojala no sea tanto",
    "cuanto se quedan ustedes? ojala sea poquito",
    "cuanto se llevan ustedes? espero que poco",
    "cuanto se quedan ustedes de mi trabajo, deberian llevarse menos",
    "el porcentaje cuanto es? tendria que ser menos",
    "el porcentaje cuanto es? me gustaria que fuera menos",
    "el porcentaje cuanto sale? ojala poco para ustedes",
    // 2ª ronda del revisor: "parte chica / achiquen su parte" (pedir a la baja) también escala.
    "cuanto se quedan ustedes? deberian llevarse una parte chica",
    "cuanto se quedan ustedes? achiquen su parte",
    "cuanto se quedan ustedes? recorten su parte un poco",
    "cuanto se quedan ustedes? deberian reducir su comision",
    // La exclusión de "al menos/por lo menos" NO debe des-escalar una negociación REAL con esos idiomas.
    "dame por lo menos el 60% a mi",
    "quiero al menos la mitad para mi"
  ];
  for (const m of mustNotGiveFigure) {
    it(`'${m}' NO da la cifra (negociación/objeción -> escala)`, () => {
      expect(givesFigure(m), m).toBe(false);
    });
  }

  // NO-REGRESIÓN: los fraseos ya cubiertos siguen dando la cifra.
  for (const m of ["de cuanto es el reparto?", "cual es el porcentaje", "cuanto me toca a mi?"]) {
    it(`no-regresión: '${m}' sigue dando la cifra`, () => {
      expect(givesFigure(m), m).toBe(true);
    });
  }

  // NO-REGRESIÓN: "cuanto queda para mi cumpleaños" (no comercial) NO debe soltar la cifra.
  it("no-regresión: 'cuanto queda para mi cumpleaños?' NO suelta la cifra (no es comercial)", () => {
    expect(givesFigure("cuanto queda para mi cumpleaños?", "OTHER")).toBe(false);
  });

  // NO-REGRESIÓN (clave): "más o menos / por lo menos / al menos / menos de" = aproximación/idiomático/tiempo,
  // NO es "quiero menos" -> SÍ da la cifra (evita reabrir el bucle; nota del revisor 20-jul 2ª ronda).
  for (const m of [
    "cuanto se quedan ustedes mas o menos?",
    "el porcentaje cuanto es mas o menos?",
    "por lo menos cuanto me toca?",
    "al menos cuanto me llevo yo?",
    "cuanto es el reparto? tengo menos de un mes mirando esto"
  ]) {
    it(`no-regresión: '${m}' SÍ da la cifra (menos idiomático, no negociación)`, () => {
      expect(givesFigure(m), m).toBe(true);
    });
  }
});
