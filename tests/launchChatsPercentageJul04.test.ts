import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { buildResponsePlan } from "@/application/responsePlanner";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// LANZAMIENTO REAL 3-jul: Mayra (34, iPhone 15, interesada) se PERDIÓ preguntando el porcentaje tres
// veces ("Qué porcentaje" → "Okeyy"; "?" → repetición; "q porcentaje sería para mi..." → "Okeyy").
// Y a Eli le pasó igual. Estas son las frases LITERALES de los chats reales: jamás deben volver a
// recibir un acuse vacío ni la evasiva del salario — piden la CIFRA y se responde 70/30 con el porqué.

function understandingWith(intent: string, extractedData: Record<string, unknown> = {}) {
  return ModelConversationOutputSchema.parse({
    intent,
    extractedData,
    confidence: 0.85,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: ""
  });
}

function planFor(message: string, candidateOverrides: Record<string, unknown> = {}) {
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "mayra_real" }),
    firstName: "Mayra",
    age: 34,
    isAdultConfirmed: true,
    currentState: "WAITING_HUMAN_REVIEW",
    ...candidateOverrides
  });
  return buildResponsePlan({
    candidate,
    understanding: understandingWith("ASKS_ABOUT_PERCENTAGE"),
    inboundMessage: message,
    knowledgeEntries: [],
    hasApprovedNegotiationDecision: false,
    recentAgentMessages: [],
    isOpenerTurn: false
  });
}

describe("las frases REALES de Mayra y Eli piden la cifra: el plan lleva el 70/30", () => {
  const REAL_PHRASES = [
    "Qué porcentaje",
    "Si, lo Entendí pero q porcentaje sería para mi y q porcentaje Para ustedes",
    "Cual es el porcentaje?",
    "Cual es su comision y mi ganancia"
  ];
  for (const phrase of REAL_PHRASES) {
    it(`"${phrase}" -> answerFacts con el 70/30 (sin boilerplate de salario)`, () => {
      const plan = planFor(phrase);
      const all = plan.answerFacts.join(" ");
      expect(all, `answerFacts para "${phrase}"`).toMatch(/70%/);
      expect(all).toMatch(/30%/);
      expect(all.toLowerCase()).not.toContain("salario");
    });
  }

  it("la pregunta del MODELO de pago ('porcentaje o salario fijo?') sigue SIN cifra", () => {
    const plan = planFor("porcentaje o salario fijo?");
    expect(plan.answerFacts.join(" ")).not.toMatch(/70%|30%/);
  });

  it("INVARIANTE 3: la negociación sigue ganando ('q porcentaje seria para mi? quiero el 50')", () => {
    const plan = planFor("q porcentaje seria para mi? quiero el 50");
    expect(plan.answerFacts.join(" ")).not.toMatch(/70%|30%/);
  });

  // Revisor 4-jul: "minimo el 50" pegado a la pregunta escapaba a isCommercialEscalation (sin "quiero",
  // sin "%") y el flip le daba la cifra CON una demanda de negociación en el mismo mensaje.
  it("INVARIANTE 3 (revisor): 'q porcentaje, minimo el 50' es negociación -> escalada, sin cifra", () => {
    const plan = planFor("q porcentaje, minimo el 50");
    expect(plan.humanReviewReason).toBe("PERCENTAGE_NEGOTIATION");
    expect(plan.answerFacts.join(" ")).not.toMatch(/70%|30%/);
  });

  it("INVARIANTE 3 (revisor): 'que porcentaje me toca? minimo un 40' -> escalada, sin cifra", () => {
    // Con "?" y sin conocimiento inyectado el motivo estructurado es OTHER (pregunta sin cobertura);
    // lo invariante es que ESCALA y que la cifra NO sale (sin el fix, answerFacts traia el 70/30).
    const plan = planFor("que porcentaje me toca? minimo un 40");
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.answerFacts.join(" ")).not.toMatch(/70%|30%/);
  });

  it("la pregunta benigna 'que porcentaje se lleva la agencia?' SIGUE liberando el 70/30 (sin sobre-frenar)", () => {
    const plan = planFor("que porcentaje se lleva la agencia?");
    expect(plan.humanReviewReason).not.toBe("PERCENTAGE_NEGOTIATION");
    expect(plan.answerFacts.join(" ")).toMatch(/70%/);
  });
});

describe("E2E con el motor determinista: la conversación de Mayra ya no muere", () => {
  it("'Qué porcentaje' en WAITING_HUMAN_REVIEW -> responde el 70/30, JAMÁS un 'Okeyy' vacío", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever()
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "mayra_e2e" }),
        firstName: "Mayra",
        age: 34,
        isAdultConfirmed: true,
        deviceModel: "iphone 15",
        deviceEligibility: "APPROVED",
        hasOnlyFans: false,
        currentState: "WAITING_HUMAN_REVIEW"
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "mayra_e2e",
      message: "Qué porcentaje"
    });
    expect(result.response).toContain("70%");
    expect(result.response).toContain("30%");
    expect(result.response.trim().toLowerCase()).not.toBe("okeyy");
    // Y sigue en revisión (no reabre el flujo).
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });
});
