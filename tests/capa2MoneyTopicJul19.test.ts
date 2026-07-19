import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { buildResponsePlan } from "@/application/responsePlanner";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingInput,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput
} from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// CAPA 2 (19-jul, corregida tras el revisor). PRINCIPIO INNEGOCIABLE (invariante 1): el % lo decide CODIGO
// determinista, JAMAS la salida del modelo. Por eso:
//  - La CIFRA (70/30) se dispara SOLO por deteccion determinista (regex ampliado, gateado por interrogativo).
//    moneyTopic=FIGURE NO libera la cifra por si solo (el revisor demostro que eso fugaba 42/50 negociaciones).
//  - La IA solo puede volver el trato MAS SEGURO (fail-safe): moneyTopic=NEGOTIATE ESCALA (mas supervision
//    humana), moneyTopic=PAYMENT_MODEL VETA la cifra. Nunca suelta una cifra que el codigo no autorice.

function understanding(
  moneyTopic: ModelConversationOutput["moneyTopic"],
  intent: ModelConversationOutput["intent"] = "OTHER"
): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent,
    extractedData: {},
    confidence: 0.9,
    moneyTopic,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: ""
  });
}

function candidateQualifying(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "c2" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);
}

function plan(message: string, u: ModelConversationOutput) {
  return buildResponsePlan({
    candidate: candidateQualifying(),
    understanding: u,
    inboundMessage: message,
    knowledgeEntries: [],
    hasApprovedNegotiationDecision: false,
    recentAgentMessages: [],
    isOpenerTurn: false
  });
}

const hasFigure = (facts: string[]) => facts.some((f) => /\b70\s?%|30\s?%|70\/30\b/.test(f));

describe("Capa 2 — INVARIANTE 1: moneyTopic=FIGURE del modelo NUNCA libera la cifra por si solo", () => {
  // Estas son las negociaciones/afirmaciones que el revisor cazo filtrando cuando FIGURE gateaba. Ahora, con
  // FIGURE=FIGURE forzado (peor caso: la IA etiqueta mal una negociacion como pregunta), NO debe soltar la cifra
  // porque la deteccion determinista no ve una pregunta de cifra.
  const negacionesQueLaIaPodriaEtiquetarMalFIGURE = [
    // Lista COMPLETA de las fugas que el revisor demostro cuando FIGURE gateaba (42/50). Con FIGURE ya sin poder
    // liberar la cifra, NINGUNA debe soltar el 70/30.
    "quiero un porcentaje mayor",
    "yo quiero mas de 30",
    "30 es poco para mi",
    "el 30 es una miseria",
    "prefiero quedarme con la mitad",
    "quiero minimo la mitad",
    "denme un cachito mas",
    "haganme precio",
    "en otra agencia me daban mas",
    "por menos del 50 no laburo",
    "podrias hacer una excepcion conmigo",
    "40 60 se podria?",
    "podria ser 50 y 50?",
    "y un 60 40 para mi?",
    "en otra me dejaban el 50",
    "y no me pueden dejar un poquito mas?",
    "mejoren la oferta para mi",
    "me conformo con el 45",
    "aunque sea denme el 35",
    "el 30 me parece injusto igual",
    "no me alcanza con el 30"
  ];
  for (const message of negacionesQueLaIaPodriaEtiquetarMalFIGURE) {
    it(`moneyTopic=FIGURE + '${message}' -> NO suelta la cifra (el modelo no gatea el %)`, () => {
      const p = plan(message, understanding("FIGURE"));
      expect(hasFigure(p.answerFacts), message).toBe(false);
    });
  }
});

describe("Capa 2 — el regex ampliado NO filtra la cifra a negociaciones por la via DETERMINISTA (fallback, moneyTopic=NONE)", () => {
  // 2a tanda del revisor: contrapropuestas con "split"/"division" y objeciones en 3a persona. La via SIN IA
  // (fallback) debe ser segura por si sola: NINGUNA suelta el 70/30.
  const negacionesDeterministas = [
    "el split 50 50 se puede?",
    "un split 60 40 para mi?",
    "un split donde yo gane mas se puede?",
    "un split mas parejo?",
    "podemos ver un split diferente?",
    "el split ese es medio choto no?",
    "es un monton lo que se quedan no?",
    "un montonazo lo que se llevan eh?",
    "y por que se llevan tanto?",
    "la division de la plata no es justa no?"
  ];
  for (const message of negacionesDeterministas) {
    it(`fallback (NONE) '${message}' -> NO suelta la cifra`, () => {
      expect(hasFigure(plan(message, understanding("NONE")).answerFacts), message).toBe(false);
    });
  }

  // 3a tanda del revisor: mensajes COMPUESTOS (pregunta la cifra + negocia en el mismo turno). Aun por la via
  // determinista (NONE) NO deben soltar la cifra: la negociacion de la 2a clausula veta.
  const compuestos = [
    "como es el split, dejenme 40 a mi",
    "como es el split? se puede 50 50?",
    "como queda el split? prefiero 60 40",
    "cuanto es lo mio? deberia ser mas",
    "cuanto me toca? quiero ganar mas",
    "de cuanto es el reparto? quiero mas plata para mi",
    "de cuanto es el split? yo quiero la mitad",
    "cuanto os quedais? me quedo con la mitad mejor",
    // Verbos FUERA de cualquier whitelist (guard de compuesto estructural del revisor, 4a ronda):
    "cuanto me toca? me tienen que dar mas",
    "cuanto me queda? me merezco mas que eso",
    "como es el split? me corresponde mas a mi",
    "cuanto me llevo? saco mas por mi cuenta",
    "cuanto me queda? quiero quedarme con la mitad",
    // OBJECIONES/contrapropuestas sin "mas/la mitad" (guard de compuesto extendido, 5a ronda del revisor):
    "cuanto me toca? es muy poco para mi",
    "de cuanto es el reparto? es una miseria",
    "cuanto me toca? prefiero mitad y mitad",
    "cuanto saco? el 30 es injusto para mi",
    "de cuanto es el split? con eso no me alcanza",
    "cuanto me llevo? el 30 es muy bajo para mi",
    "de cuanto es el reparto? me esperaba algo mejor"
  ];
  for (const message of compuestos) {
    it(`compuesto (NONE) '${message}' -> NO suelta la cifra`, () => {
      expect(hasFigure(plan(message, understanding("NONE")).answerFacts), message).toBe(false);
    });
  }
});

describe("Capa 2 — completitud de la CIFRA por regex DETERMINISTA (fraseos que el fuzz perdia), moneyTopic=NONE", () => {
  const figureQuestions = [
    "cuanto me toca a mi del total?",
    "de cuanto es el split?",
    "la division de la plata como es?",
    "cual seria mi parte?",
    "cuanto porciento me toca?",
    "cuanto se queda la agencia de lo que facturo?",
    "cuanto os quedais vosotros?",
    "de cuanto es el reparto mas o menos?",
    "cuanto me queda? cuentame mas del trabajo",
    "cuanto me toca? es lo que mas me interesa",
    "cuanto me llevo? me gusta mas el contenido suave"
  ];
  for (const message of figureQuestions) {
    it(`'${message}' recibe el 70/30 por deteccion determinista (sin IA)`, () => {
      // (No se comprueba requiresHumanReview: con knowledgeEntries=[] una palabra como "agencia"/"mi parte"
      // dispara la rama de "sin cobertura"; en produccion el retriever trae la ficha comercial. La cifra SÍ sale.)
      const p = plan(message, understanding("NONE"));
      expect(hasFigure(p.answerFacts), message).toBe(true);
    });
  }
});

describe("Capa 2 — moneyTopic=NEGOTIATE escala (fail-safe) las negociaciones que el regex NO pilla", () => {
  const negPhrasings = [
    "no me pueden dar un poco mas a mi?",
    "se puede arreglar algo mejor para mi?",
    "quiero un porcentaje mayor",
    "en otra agencia me daban mas"
  ];
  for (const message of negPhrasings) {
    it(`'${message}' con moneyTopic=NEGOTIATE -> escala, sin cifra`, () => {
      const p = plan(message, understanding("NEGOTIATE"));
      expect(p.requiresHumanReview, message).toBe(true);
      expect(hasFigure(p.answerFacts), message).toBe(false);
    });
  }
});

describe("Capa 2 — moneyTopic=PAYMENT_MODEL veta la cifra (mas conservador)", () => {
  it("'es fijo o porcentaje?' con moneyTopic=PAYMENT_MODEL -> nunca la cifra", () => {
    const p = plan("esto es fijo o porcentaje?", understanding("PAYMENT_MODEL"));
    expect(hasFigure(p.answerFacts)).toBe(false);
  });
});

describe("Capa 2 — la red determinista sigue vetando negociaciones aunque la IA diga NONE/FIGURE", () => {
  const detNegotiations = [
    "bajad la parte de la agencia",
    "y si me dejan el 40 y ustedes se quedan con 60? dale",
    "podria ser 50/50?",
    "es demasiado lo que se llevan che",
    "me parece caro lo que se quedan"
  ];
  for (const message of detNegotiations) {
    it(`negociacion determinista '${message}' -> NO cifra, escala (incluso con moneyTopic=FIGURE)`, () => {
      const p = plan(message, understanding("FIGURE"));
      expect(hasFigure(p.answerFacts), message).toBe(false);
      expect(p.requiresHumanReview, message).toBe(true);
    });
  }
});

describe("Capa 2 — el determinista (moneyTopic=NONE) NO cambia su comportamiento previo", () => {
  it("'de cuanto seria la parte de la agencia?' sigue dando la cifra", () => {
    expect(hasFigure(plan("de cuanto seria la parte de la agencia?", understanding("NONE")).answerFacts)).toBe(true);
  });
  it("'en el 70/30 quien se queda cada parte?' da la cifra (el 70/30 no es propuesta)", () => {
    // Aqui la cifra sale por intent=ASKS_ABOUT_PERCENTAGE + regex "70/30" (como la clasifica el extractor real).
    const p = plan("en el 70/30 quien se queda cada parte?", understanding("NONE", "ASKS_ABOUT_PERCENTAGE"));
    expect(hasFigure(p.answerFacts)).toBe(true);
    expect(p.requiresHumanReview).toBe(false);
  });
  it("'esto es un sueldo fijo o porcentaje?' NO da la cifra (modelo de pago)", () => {
    expect(hasFigure(plan("esto es un sueldo fijo o porcentaje?", understanding("NONE")).answerFacts)).toBe(false);
  });
  it("'hola que tal' no da cifra ni escala", () => {
    const p = plan("hola que tal", understanding("NONE"));
    expect(hasFigure(p.answerFacts)).toBe(false);
    expect(p.requiresHumanReview).toBe(false);
  });
});

// Proveedor FALSO que imita a la IA de produccion: delega en el determinista y SOBREESCRIBE moneyTopic.
class FakeIaUnderstanding implements ConversationUnderstandingProvider {
  constructor(private readonly table: Record<string, ModelConversationOutput["moneyTopic"]>) {}
  private readonly det = new DeterministicUnderstandingProvider();
  async understand(input: ConversationUnderstandingInput): Promise<ModelConversationOutput> {
    const base = await this.det.understand(input);
    const money = this.table[input.inboundMessage.trim().toLowerCase()];
    return money ? { ...base, moneyTopic: money } : base;
  }
}

describe("Capa 2 E2E (motor con IA falsa)", () => {
  function engineWith(table: Record<string, ModelConversationOutput["moneyTopic"]>) {
    return new ConversationEngine({
      repository: new InMemoryCandidateRepository(),
      understandingProvider: new FakeIaUnderstanding(table),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
  }
  async function toQualifying(engine: ConversationEngine, u: string) {
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo carla" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 33" }] });
  }

  it("FIGURE end-to-end: 'cuanto me toca a mi del total?' responde el 70/30 (por regex, no por la IA)", async () => {
    const msg = "cuanto me toca a mi del total?";
    const engine = engineWith({ [msg]: "FIGURE" });
    const u = "c2fig_" + Math.random().toString().slice(2, 6);
    await toQualifying(engine, u);
    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: msg }] });
    expect(r.response).toMatch(/70/);
  });

  it("NEGOTIATE end-to-end: 'no me pueden dar un poco mas a mi?' escala y NO da la cifra", async () => {
    const msg = "no me pueden dar un poco mas a mi?";
    const engine = engineWith({ [msg]: "NEGOTIATE" });
    const u = "c2neg_" + Math.random().toString().slice(2, 6);
    await toQualifying(engine, u);
    const r = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: msg }] });
    expect(r.response).not.toMatch(/\b70\s?%|30\s?%|70\/30\b/);
    expect(r.responsePlan?.requiresHumanReview).toBe(true);
  });
});
