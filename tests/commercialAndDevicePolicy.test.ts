import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { validateFactualResponse } from "@/application/factualValidator";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { deviceEligibilityForDescription } from "@/application/policyRules";
import { evaluateQualificationReadiness } from "@/application/qualificationPolicy";
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

  it("answers exact percentage question with confirmed 70/30", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "percentage_confirmed_case",
      profileVisibility: "PUBLIC",
      message: "Cual es el porcentaje exacto?"
    });

    expect(result.response).toContain("70%");
    expect(result.response).toContain("30%");
    expect(result.responsePlan.requiresHumanReview).toBe(false);
  });

  it("accepts a confirmed percentage policy shape", () => {
    const policy = RevenueSharePolicySchema.parse({
      agencyPercentage: 70,
      modelPercentage: 30,
      isConfirmed: true,
      discloseOnlyWhenExplicitlyAsked: true,
      canExplainNoFixedSalaryInChat: true,
      canDiscloseExactPercentagesInChat: true,
      canNegotiateByChat: false,
      negotiationRequiresHumanReview: true,
      approvedGeneralExplanation: "Va por reparto.",
      approvedPercentageExplanation: "El reparto autorizado es 70% para la agencia y 30% para la modelo.",
      minimumAgencyPercentage: 60,
      maximumModelPercentage: 40,
      calculationBasis: "NET_AFTER_PLATFORM_COMMISSION",
      platformPayoutRecipient: "MODEL",
      paymentMethodToAgency: "SKRILL",
      settlementIntervalDays: 14,
      settlementStartsFromFirstRevenue: true,
      alexCalculatesSettlementManually: true,
      version: "test-confirmed-policy"
    });

    expect(policy.agencyPercentage).toBe(70);
    expect(policy.modelPercentage).toBe(30);
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
      currentPolicyAgencyPercentage: 70,
      currentPolicyModelPercentage: 30,
      decision: "ALLOW_CUSTOM_TERMS",
      approvedAgencyPercentage: 65,
      approvedModelPercentage: 35,
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

    expect(second.response).toContain("35%");
    expect(second.response).toContain("65%");
    expect(second.response).not.toContain("90%");
  });

  it("stores iPhone and continues qualification", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "iphone_case",
      profileVisibility: "PUBLIC",
      message: "Si, tengo iPhone 13"
    });

    expect(result.candidate.deviceType).toBe("IPHONE");
    expect(result.candidate.deviceModel).toBe("iphone 13");
    expect(result.candidate.deviceEligibility).toBe("APPROVED");
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("pauses low quality Android candidates and does not invent an exception", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "android_case",
      profileVisibility: "PUBLIC",
      message: "Tengo un Android barato de mala calidad"
    });

    expect(result.candidate.deviceType).toBe("OTHER");
    expect(result.candidate.deviceEligibility).toBe("NOT_ELIGIBLE");
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

    expect(result.candidate.deviceEligibility).toBe("PENDING_UPGRADE");
    expect(result.response.toLowerCase()).not.toContain("no pasa nada");
    expect(result.response.toLowerCase()).not.toContain("sirve igual");
  });

  it("classifies iPhone 11 and 12 as pending quality test, not rejected", () => {
    expect(deviceEligibilityForDescription("Tengo iPhone 11")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("Tengo iPhone 12")).toBe("PENDING_QUALITY_TEST");
  });

  it("iPhone <=10 y Samsung de gama baja (A/J) = CLARAMENTE malo -> NOT_ELIGIBLE (pausa; Alex 22-jun)", () => {
    // Dudoso (iPhone 11/12) sigue cualificando; claramente viejo/gama baja pausa para decision de Alex (HIR).
    expect(deviceEligibilityForDescription("Tengo iPhone 8")).toBe("NOT_ELIGIBLE");
    expect(deviceEligibilityForDescription("tengo un iphone 10")).toBe("NOT_ELIGIBLE");
    expect(deviceEligibilityForDescription("tengo un samsung a15")).toBe("NOT_ELIGIBLE");
    expect(deviceEligibilityForDescription("galaxy a54")).toBe("NOT_ELIGIBLE");
    // Frontera: 11/12 siguen siendo dudosos (no rechazados) y S23+ aprobado.
    expect(deviceEligibilityForDescription("iPhone 11")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("galaxy s24")).toBe("APPROVED");
  });

  it("iPhone 11/12 Pro y Pro Max = APROBADO directo (buena camara; Alex 22-jun)", () => {
    expect(deviceEligibilityForDescription("iphone 12 pro max")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("tengo un iphone 11 pro")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("iPhone 12 Pro")).toBe("APPROVED");
    // El 11/12 NORMAL (sin Pro) sigue dudoso.
    expect(deviceEligibilityForDescription("iphone 12")).toBe("PENDING_QUALITY_TEST");
  });

  it("tolerates common iphone typos so the device slot is not re-asked (spot-check de Alex: 'ipone 13')", () => {
    // "ipone 13" daba UNKNOWN -> el slot del movil se preguntaba en bucle.
    expect(deviceEligibilityForDescription("ipone 13")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("tengo un ifone 14")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("iphon 11")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("tengo un ipone")).toBe("PENDING_QUALITY_TEST");
  });

  it("does not misread common Spanish words as an iphone (sin falsos positivos)", () => {
    expect(deviceEligibilityForDescription("no me lo pienso")).toBe("UNKNOWN");
    expect(deviceEligibilityForDescription("eso me lo impone la agencia")).toBe("UNKNOWN");
    expect(deviceEligibilityForDescription("propone otra cosa")).toBe("UNKNOWN");
    expect(deviceEligibilityForDescription("cuando dispongo de tiempo")).toBe("UNKNOWN");
  });

  it("allows excellent candidate with future iPhone to human review and call but blocks onboarding", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "future_iphone_excellent_case",
      profileVisibility: "PUBLIC",
      message:
        "Soy Laura, tengo 34 anos, soy de Argentina, tengo experiencia creando contenido, estoy disponible por las tardes y me comprare un iPhone pronto"
    });
    const readiness = evaluateQualificationReadiness(result.candidate);

    expect(result.candidate.deviceEligibility).toBe("PENDING_UPGRADE");
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(readiness.readyForHumanReview).toBe(true);
    expect(readiness.readyForCall).toBe(true);
    expect(readiness.readyForOnboarding).toBe(false);
    expect(readiness.onboardingBlockers).toContain("DEVICE_UPGRADE_REQUIRED");
  });

  it("removes device onboarding blocker after confirming valid device", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "future_iphone_resolved_case",
      profileVisibility: "PUBLIC",
      message:
        "Tengo 34 anos, soy de Argentina, tengo experiencia creando contenido, estoy disponible por las tardes y me comprare un iPhone pronto"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "future_iphone_resolved_case",
      profileVisibility: "PUBLIC",
      message: "Ya tengo iPhone 13"
    });
    const readiness = evaluateQualificationReadiness(second.candidate);

    expect(second.candidate.deviceEligibility).toBe("APPROVED");
    expect(readiness.onboardingBlockers).not.toContain("DEVICE_UPGRADE_REQUIRED");
    expect(readiness.onboardingBlockers).not.toContain("DEVICE_QUALITY_TEST_REQUIRED");
    expect(readiness.onboardingBlockers).toContain("IDENTITY_VERIFICATION_REQUIRED");
    expect(readiness.onboardingBlockers).toContain("CONTRACT_REQUIRED");
  });

  it("does not pass to final review with unknown device", async () => {
    const { engine } = createEngine();
    const turns = [
      "Soy Ana, tengo 24 anos y soy de Madrid",
      "si tengo onlyfans activo",
      "no he trabajado con agencias",
      "puedo dedicarle las tardes",
      "vale, sin problema"
    ];
    const responses: string[] = [];
    let id: string | undefined;
    let last: Awaited<ReturnType<typeof engine.handleIncomingMessage>> | undefined;
    for (const message of turns) {
      last = await engine.handleIncomingMessage({
        candidateId: id,
        instagramUsername: "missing_iphone_case",
        profileVisibility: "PUBLIC",
        message
      });
      id = last.candidate.id;
      responses.push(last.response.toLowerCase());
    }

    // Da todos los datos MENOS el movil: con dispositivo desconocido NUNCA pasa a revision final, y el
    // bot debe preguntar por el movil en algun momento del guion.
    expect(last?.candidate.deviceEligibility).toBe("UNKNOWN");
    expect(last?.candidate.currentState).not.toBe("WAITING_HUMAN_REVIEW");
    expect(responses.some((response) => response.includes("movil"))).toBe(true);
  });

  it("does not ask for device again once answered", async () => {
    const { engine } = createEngine();
    const first = await engine.handleIncomingMessage({
      instagramUsername: "device_once_case",
      profileVisibility: "PUBLIC",
      message: "Tengo iPhone 13"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "device_once_case",
      profileVisibility: "PUBLIC",
      message: "Tengo 22 anos"
    });

    expect(second.response.toLowerCase()).not.toContain("que movil tienes");
  });

  it("factual validation blocks a custom percentage without approval", () => {
    const plan = buildResponsePlan({
      candidate: {
        id: "candidate",
        instagramUsername: "candidate",
        age: 22,
        isAdultConfirmed: true,
        deviceType: "IPHONE",
        deviceModel: "iphone 13",
        deviceEligibility: "APPROVED",
        commercialTier: "STANDARD",
        declaredProfileVisibility: "PUBLIC",
        candidateClaimsFollowRequestAccepted: false,
        humanVerifiedProfileAccess: false,
        humanProfileReviewStatus: "NOT_REVIEWED",
        humanFitDecision: "PENDING",
        objections: [],
        faceObjectionCount: 0,
        callAttempts: 0,
        pendingInbound: [],
        notes: [],
        conversationSummary: "",
        currentState: "QUALIFYING",
        humanReviewStatus: "NOT_REQUIRED",
        onboardingBlockers: [],
        interestLevel: "UNKNOWN",
        automationPaused: false,
        manualControlActive: false,
        generationCancellationVersion: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      understanding: ModelConversationOutputSchema.parse({
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
      }),
      inboundMessage: "Me dais el 90%?",
      knowledgeEntries: []
    });

    const validation = validateFactualResponse("Podemos darte el 90% sin problema.", plan);
    expect(validation.valid).toBe(false);
  });
});
