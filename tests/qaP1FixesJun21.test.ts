import { describe, expect, it } from "vitest";
import { ConversationEngine, acknowledgementFor } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones de los P1 (lead-killers) de la QA E2E del 21-jun.

function understand(message: string, lastAgentMessage = "Hola") {
  return extractDeterministicUnderstanding(message, { lastAgentMessage });
}

// --- P1-2: voseo "sos un bot / sos una persona o un bot" -> transparencia ---
describe("QA P1-2: voseo bot/persona dispara la respuesta de transparencia", () => {
  const cases = ["sos un bot?", "sos una persona real o un bot?", "esto es un bot?", "estoy hablando con una maquina?"];
  for (const message of cases) {
    it(`"${message}" -> REQUESTS_HUMAN con motivo de IA/bot`, () => {
      const u = understand(message);
      expect(u.intent).toBe("REQUESTS_HUMAN");
      expect(u.requiresHumanReview).toBe(true);
      expect((u.humanReviewReason ?? "").toLowerCase()).toMatch(/ia|bot/);
    });
  }
});

// --- P1-3: sospecha hipotetica en voz -> tranquilizar, no expulsar ---
describe("QA P1-3: 'y si esto es una estafa?' tranquiliza (no handoff)", () => {
  it("hipotetica con 'esto' en medio -> distrust", () => {
    expect(classifyCallSignal({ utterance: "y si esto es una estafa?" })).toBe("distrust");
    expect(classifyCallSignal({ utterance: "y si esto fuera un timo?" })).toBe("distrust");
  });
  it("acusacion DIRECTA sigue siendo hostil (no se ablanda de mas)", () => {
    expect(classifyCallSignal({ utterance: "esto es una estafa, sois unos ladrones" })).toBe("hostile-or-suspicious");
  });
});

// --- P1-4: quiere pensarlo / comparativas ---
describe("QA P1-4: 'me lo tengo que pensar' y comparativas en voz", () => {
  for (const utterance of ["me lo tengo que pensar", "lo voy a pensar", "dejame pensarlo", "necesito pensarlo"]) {
    it(`"${utterance}" -> wants-to-think (no ASK_REPEAT/DEFER)`, () => {
      expect(classifyCallSignal({ utterance })).toBe("wants-to-think");
    });
  }
  it("'pienso que esta bien' (opinion) NO es wants-to-think", () => {
    expect(classifyCallSignal({ utterance: "pienso que esta bien" })).not.toBe("wants-to-think");
  });
  it("comparativa con otra agencia (en negociacion) -> complains-about-share", () => {
    expect(classifyCallSignal({ utterance: "en la otra agencia me dejan el 50", moneyContext: true })).toBe(
      "complains-about-share"
    );
  });
});

// --- P1-5: quejas del reparto en voz ---
describe("QA P1-5: quejas del reparto se detectan (no ASK_REPEAT)", () => {
  for (const utterance of ["me parece mucho", "es bastante para vosotros", "os llevais demasiado"]) {
    it(`"${utterance}" (negociacion) -> complains-about-share`, () => {
      expect(classifyCallSignal({ utterance, moneyContext: true })).toBe("complains-about-share");
    });
  }
});

// --- P1-6: cifra del reparto a quien pregunta SU parte + escala negociacion ---
describe("QA P1-6: reparto propio y escalada de negociacion", () => {
  it("'subime un poco mi parte' -> escala a revision humana", () => {
    const u = understand("subime un poco mi parte");
    expect(u.intent).toBe("ASKS_ABOUT_PERCENTAGE");
    expect(u.requiresHumanReview).toBe(true);
  });
  it("'me quedo con 60/40?' (no estandar) -> escala", () => {
    const u = understand("y si me quedo con 60/40 mi parte?");
    expect(u.requiresHumanReview).toBe(true);
  });

  it("preguntar la PROPIA parte da la cifra 70/30 (no se oculta)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "p6_share", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING"
      })
    );
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "cuanto me llevo yo?"
    });
    expect(reply.response).toMatch(/70|30/);
  });
});

// --- P1-8: movil malo sin nombrar el aparato no se queda en limbo ---
describe("QA P1-8: movil malo descrito sin nombrar el aparato", () => {
  const deviceAsk = "Y que movil tienes? Es importante para la calidad de fotos y videos.";
  it("'uno viejo' (tras preguntar movil) -> NOT_ELIGIBLE (no UNKNOWN)", () => {
    expect(extractDeterministicUnderstanding("uno viejo", { lastAgentMessage: deviceAsk }).extractedData.deviceEligibility).toBe(
      "NOT_ELIGIBLE"
    );
  });
  it("'malisimo' (tras preguntar movil) -> se clasifica (no se queda en limbo)", () => {
    const elig = extractDeterministicUnderstanding("malisimo", { lastAgentMessage: deviceAsk }).extractedData.deviceEligibility;
    expect(elig).toBeDefined();
    expect(elig).not.toBe("UNKNOWN");
  });
  it("'uno viejo' SIN contexto de movil NO dispara (no falso positivo sobre la persona)", () => {
    expect(
      extractDeterministicUnderstanding("uno viejo", { lastAgentMessage: "como te llamas?" }).extractedData.deviceEligibility
    ).toBeUndefined();
  });
});

// --- P1-10: acuse empatico ante duda blanda (no "Perfecto" frio) ---
describe("QA P1-10: duda emocional blanda recibe acuse empatico", () => {
  for (const message of ["no me convence mucho la verdad", "me da un poco de cosa", "no se yo, tengo mis dudas"]) {
    it(`"${message}" -> "Te entiendo" (no Perfecto/Okeyy)`, () => {
      const ack = acknowledgementFor(understand(message), message);
      expect(ack).toMatch(/entiendo/i);
    });
  }
});

// --- P1-1: multi-pregunta no descarta el resto (smoke) ---
describe("QA P1-1: multi-pregunta cubre mas de un tema", () => {
  it("varias preguntas a la vez -> responde con varias frases, no una sola", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "p1_multi", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING"
      })
    );
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "cual es el proceso? me cuesta algo entrar? como funciona todo?"
    });
    // No debe quedarse en una sola frase seca: respuesta con contenido real.
    expect(reply.response.length).toBeGreaterThan(40);
  });
});

// --- Fixes del revisor (invariante 3 e2e): no-fuga del % en afirmaciones + escalada de negociacion ---
describe("QA P1 revisor: invariante 3 end-to-end + no falsos positivos", () => {
  async function qualifyingReply(message: string) {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `rv_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING"
      })
    );
    return engine.handleIncomingMessage({ candidateId: seeded.id, instagramUsername: seeded.instagramUsername, message });
  }

  // B1 (invariante 3): "mi parte" en AFIRMACION no debe filtrar el 70/30 de forma proactiva.
  for (const message of ["yo hago mi parte del trabajo y vosotros la vuestra", "yo siempre cumplo con mi parte"]) {
    it(`"${message}" NO filtra la cifra del reparto`, async () => {
      const reply = await qualifyingReply(message);
      expect(reply.response).not.toMatch(/70|30/);
    });
  }

  // B2 (invariante 3): negociacion real escala a revision humana (e2e, no solo el extractor).
  for (const message of ["subidme mi parte al 40", "me quedo con poco, bajame la comision", "mejorame el reparto"]) {
    it(`"${message}" -> escala a revision humana`, async () => {
      const reply = await qualifyingReply(message);
      expect(reply.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    });
  }

  // R1: "programa" ya no es falso positivo de bot.
  it("'sois un programa serio de modelos?' NO se trata como pregunta de bot", () => {
    expect(understand("sois un programa serio de modelos?").intent).not.toBe("REQUESTS_HUMAN");
  });

  // R2: "voy a mirar el movil" no es wants-to-think.
  it("'voy a mirar el movil ahora' NO es wants-to-think", () => {
    expect(classifyCallSignal({ utterance: "voy a mirar el movil ahora" })).not.toBe("wants-to-think");
  });
});
