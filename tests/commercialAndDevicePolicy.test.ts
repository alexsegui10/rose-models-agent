import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { validateFactualResponse } from "@/application/factualValidator";
import { buildResponsePlan } from "@/application/responsePlanner";
import { RevenueSharePolicySchema } from "@/domain/businessKnowledge";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever()
  });

  return { engine, repository };
}

describe("commercial and device policy", () => {
  it("does not mention percentage when it is not relevant", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "no_percentage_case",
      profileVisibility: "PUBLIC",
      message: "Hola, me interesa. Tengo 22 anos y soy de Madrid."
    });

    expect(result.response.toLowerCase()).not.toContain("porcentaje");
    expect(result.response.toLowerCase()).not.toContain("reparto");
  });

  it("answers if there is a salary", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "salary_question_case",
      profileVisibility: "PUBLIC",
      message: "Hay salario fijo?"
    });

    expect(result.response.toLowerCase()).toContain("salario fijo");
    expect(result.response.toLowerCase()).toContain("reparto");
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("answers explicit percentage question without exact figures while policy is unconfirmed", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "percentage_unconfirmed_case",
      profileVisibility: "PUBLIC",
      message: "Que porcentaje seria?"
    });

    expect(result.response.toLowerCase()).toContain("reparto");
    expect(result.response).not.toContain("70");
    expect(result.responsePlan.requiresHumanReview).toBe(false);
  });

  it("accepts a confirmed percentage policy shape", () => {
    const policy = RevenueSharePolicySchema.parse({
      agencyPercentage: 30,
      modelPercentage: 70,
      isConfirmed: true,
      discloseOnlyWhenExplicitlyAsked: true,
      canExplainNoFixedSalaryInChat: true,
      canDiscloseExactPercentagesInChat: true,
      canNegotiateByChat: false,
      negotiationRequiresHumanReview: true,
      approvedGeneralExplanation: "Va por reparto.",
      approvedPercentageExplanation: "El reparto autorizado es 70% para la modelo y 30% para la agencia.",
      minimumAgencyPercentage: 20,
      maximumModelPercentage: 80,
      version: "test-confirmed-policy"
    });

    expect(policy.agencyPercentage).toBe(30);
    expect(policy.modelPercentage).toBe(70);
  });

  it("escalates percentage negotiation and does not offer a new figure", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "percentage_negotiation_case",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% a mi?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.candidate.humanReviewReason).toBe("PERCENTAGE_NEGOTIATION");
    expect(result.response).not.toContain("90%");
    expect(result.response.toLowerCase()).toContain("perfil");
  });

  it("can communicate only a human-approved custom condition", async () => {
    const { engine, repository } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "approved_terms_case",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% a mi?"
    });
    await repository.saveNegotiationDecision({
      candidateId: first.candidate.id,
      requestedModelPercentage: 90,
      currentPolicyAgencyPercentage: null,
      currentPolicyModelPercentage: null,
      decision: "ALLOW_CUSTOM_TERMS",
      approvedAgencyPercentage: 20,
      approvedModelPercentage: 80,
      reason: "Perfil con potencial alto.",
      decidedBy: "Alex",
      decidedAt: new Date()
    });

    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "approved_terms_case",
      profileVisibility: "PUBLIC",
      message: "Entonces que condiciones me podeis ofrecer?"
    });

    expect(second.response).toContain("80%");
    expect(second.response).toContain("20%");
    expect(second.response).not.toContain("90%");
  });

  it("stores iPhone and continues qualification", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "iphone_case",
      profileVisibility: "PUBLIC",
      message: "Si, tengo iPhone"
    });

    expect(result.candidate.phoneDeviceType).toBe("IPHONE");
    expect(result.candidate.hasRequiredIPhone).toBe(true);
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("pauses Android candidates and does not invent an exception", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "android_case",
      profileVisibility: "PUBLIC",
      message: "Tengo Android"
    });

    expect(result.candidate.phoneDeviceType).toBe("ANDROID");
    expect(result.candidate.hasRequiredIPhone).toBe(false);
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).not.toContain("sirve igual");
  });

  it("pauses when candidate says she will buy an iPhone soon without inventing an exception", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "iphone_soon_case",
      profileVisibility: "PUBLIC",
      message: "Ahora tengo Android pero me comprare un iPhone pronto"
    });

    expect(result.candidate.hasRequiredIPhone).toBeNull();
    expect(result.response.toLowerCase()).not.toContain("no pasa nada");
    expect(result.response.toLowerCase()).not.toContain("sirve igual");
  });

  it("does not pass to final review without confirmed iPhone", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "missing_iphone_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 24 anos, soy de Madrid y tengo experiencia en redes"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "missing_iphone_case",
      profileVisibility: "PUBLIC",
      message: "Estoy disponible por las tardes y no trabajo con otra agencia"
    });

    expect(second.candidate.currentState).not.toBe("WAITING_HUMAN_REVIEW");
    expect(second.response.toLowerCase()).toContain("iphone");
  });

  it("does not ask for device again once answered", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "device_once_case",
      profileVisibility: "PUBLIC",
      message: "Tengo iPhone"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "device_once_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 22 anos"
    });

    expect(second.response.toLowerCase()).not.toContain("tienes iphone");
  });

  it("factual validation blocks a custom percentage without approval", () => {
    const plan = buildResponsePlan({
      candidate: {
        id: "candidate",
        instagramUsername: "candidate",
        age: 22,
        isAdultConfirmed: true,
        phoneDeviceType: "IPHONE",
        hasRequiredIPhone: true,
        profileVisibility: "PUBLIC",
        declaredProfileVisibility: "PUBLIC",
        candidateDeclaredProfileAccessAccepted: false,
        humanVerifiedProfileAccess: false,
        profileReviewed: false,
        humanProfileReviewed: false,
        humanFitDecision: "UNKNOWN",
        objections: [],
        notes: [],
        conversationSummary: "",
        currentState: "QUALIFYING",
        humanReviewStatus: "NOT_REQUIRED",
        interestLevel: "UNKNOWN",
        automationPaused: false,
        manualControlActive: false,
        generationCancellationVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      understanding: {
        intent: "ASKS_ABOUT_PERCENTAGE",
        extractedData: {},
        dataCorrections: [],
        dataContradictions: [],
        confidence: 1,
        commercialQuestionsDetected: ["percentage"],
        requestsCall: false,
        requestsHuman: false,
        isNegotiation: true,
        requestedModelPercentage: 90,
        suggestedStateTransition: null,
        requiresHumanReview: false,
        humanReviewReason: null,
        response: "",
        internalNotes: [],
        provider: "deterministic",
        modelVersion: "deterministic-local-2026-06-08.1",
        promptVersion: "understanding-2026-06-08.1"
      },
      inboundMessage: "Me dais el 90%?",
      knowledgeEntries: []
    });

    const validation = validateFactualResponse("Podemos darte el 90% sin problema.", plan);
    expect(validation.valid).toBe(false);
  });
});
