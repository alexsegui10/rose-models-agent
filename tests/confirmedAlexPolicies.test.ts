import { describe, expect, it } from "vitest";
import { activeRevenueSharePolicy, businessKnowledgeEntries, followUpPolicy } from "@/content/business";
import { postCallSummaryRequiredFields } from "@/content/business/call-policy";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import {
  canOfferAgencyPercentage,
  canUseSixtyFortyAsFirstCounterOffer,
  communicationPolicy,
  contentProductionPolicy,
  deviceEligibilityForDescription,
  firstCounterOfferForTier,
  minimumAgencyPercentageForTier,
  nonPaymentPolicy,
  shouldAskCurrentRevenue,
  shouldAskFollowerCount,
  shouldEscalateForCommunicationDelay
} from "@/application/policyRules";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("Alex confirmed business policies", () => {
  it("discloses 70/30 only when the candidate asks for exact percentage", async () => {
    const { engine } = createEngine();
    const general = await engine.handleIncomingMessage({
      instagramUsername: "policy_no_proactive_split",
      profileVisibility: "PUBLIC",
      message: "Hola, quiero informacion. Tengo 32 anos y soy de Argentina."
    });
    const exact = await engine.handleIncomingMessage({
      instagramUsername: "policy_exact_split",
      profileVisibility: "PUBLIC",
      message: "Cual es el porcentaje exacto?"
    });

    expect(general.response).not.toContain("70%");
    expect(general.response).not.toContain("30%");
    expect(exact.response).toContain("70%");
    expect(exact.response).toContain("30%");
  });

  it("explains briefly why Rose Models receives 70 percent", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "policy_why_70",
      profileVisibility: "PUBLIC",
      message: "Por que la agencia se queda el 70%?"
    });

    expect(result.response.toLowerCase()).toContain("operativa");
    expect(result.response.length).toBeLessThan(260);
  });

  it("enforces negotiation authority by tier", () => {
    expect(minimumAgencyPercentageForTier("STANDARD")).toBe(70);
    expect(canOfferAgencyPercentage("STANDARD", 65)).toBe(false);
    expect(minimumAgencyPercentageForTier("HIGH_POTENTIAL")).toBe(65);
    expect(canOfferAgencyPercentage("HIGH_POTENTIAL", 65)).toBe(true);
    expect(minimumAgencyPercentageForTier("EXCEPTIONAL")).toBe(60);
    expect(canOfferAgencyPercentage("EXCEPTIONAL", 60)).toBe(true);
    expect(canOfferAgencyPercentage("EXCEPTIONAL", 59)).toBe(false);
    expect(firstCounterOfferForTier("EXCEPTIONAL")).toBe(65);
    expect(canUseSixtyFortyAsFirstCounterOffer()).toBe(false);
  });

  it("stores confirmed settlement terms", () => {
    expect(activeRevenueSharePolicy.calculationBasis).toBe("NET_AFTER_PLATFORM_COMMISSION");
    expect(activeRevenueSharePolicy.platformPayoutRecipient).toBe("MODEL");
    expect(activeRevenueSharePolicy.paymentMethodToAgency).toBe("SKRILL");
    expect(activeRevenueSharePolicy.settlementIntervalDays).toBe(14);
    expect(activeRevenueSharePolicy.settlementStartsFromFirstRevenue).toBe(true);
    expect(activeRevenueSharePolicy.alexCalculatesSettlementManually).toBe(true);
  });

  it("stores non-payment policy without unlimited content rights", () => {
    expect(nonPaymentPolicy.gracePeriodDays).toBe(7);
    expect(nonPaymentPolicy.reminderRequired).toBe(true);
    expect(nonPaymentPolicy.suspendAfterGracePeriod).toBe(true);
    expect(nonPaymentPolicy.grantsUnlimitedContentRights).toBe(false);
  });

  it("stores communication delay rules", () => {
    expect(communicationPolicy.expectedResponseTimeHours).toBe(48);
    expect(communicationPolicy.singleDelayCausesRejection).toBe(false);
    expect(shouldEscalateForCommunicationDelay(1)).toBe(false);
    expect(shouldEscalateForCommunicationDelay(2)).toBe(true);
  });

  it("stores content production targets as non-contractual", () => {
    expect(contentProductionPolicy.warmupDays).toBe(5);
    expect(contentProductionPolicy.warmupPhotosPerDayMin).toBe(2);
    expect(contentProductionPolicy.warmupPhotosPerDayMax).toBe(3);
    expect(contentProductionPolicy.targetReelsPerWeekMin).toBe(10);
    expect(contentProductionPolicy.targetReelsPerWeekMax).toBe(20);
    expect(contentProductionPolicy.isContractualMinimumConfirmed).toBe(false);
  });

  it("answers Instagram new content and OnlyFans old material only when asked", async () => {
    const { engine } = createEngine();
    const instagram = await engine.handleIncomingMessage({
      instagramUsername: "policy_new_instagram",
      profileVisibility: "PUBLIC",
      message: "El contenido para Instagram puede estar publicado antes?"
    });
    const oldMaterial = await engine.handleIncomingMessage({
      instagramUsername: "policy_old_of",
      profileVisibility: "PUBLIC",
      message: "Puedo reutilizar material antiguo para OnlyFans?"
    });

    expect(instagram.response.toLowerCase()).toContain("nuevo");
    expect(oldMaterial.response.toLowerCase()).toContain("material antiguo");
  });

  it("classifies device eligibility", () => {
    expect(deviceEligibilityForDescription("Tengo iPhone 13")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("Tengo Samsung Galaxy S23")).toBe("APPROVED");
    expect(deviceEligibilityForDescription("Tengo un Pixel 8 Pro")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("Me comprare un iPhone pronto")).toBe("PENDING_UPGRADE");
    expect(deviceEligibilityForDescription("Tengo un Android barato de mala calidad")).toBe("NOT_ELIGIBLE");
    // Gate real de Alex: Motorola E32 rechazado ("con ese movil no podemos trabajar").
    expect(deviceEligibilityForDescription("Motorola E32")).toBe("NOT_ELIGIBLE");
    expect(deviceEligibilityForDescription("Tengo un moto g22")).toBe("NOT_ELIGIBLE");
    expect(deviceEligibilityForDescription("Tengo un motorola")).toBe("PENDING_QUALITY_TEST");
  });

  it("does not ask followers and asks revenue only for active OnlyFans", () => {
    expect(shouldAskFollowerCount()).toBe(false);
    expect(shouldAskCurrentRevenue(false)).toBe(false);
    expect(shouldAskCurrentRevenue(undefined)).toBe(false);
    expect(shouldAskCurrentRevenue(true)).toBe(true);
  });

  it("keeps physical profile review human-only", () => {
    const entry = businessKnowledgeEntries.find((item) => item.id === "candidate-requirements-target-profile");

    expect(entry?.prohibitedClaims).toContain("Puntuar atractivo.");
    expect(entry?.mandatoryNuances).toContain("El chatbot recopila datos y pasa el perfil a revision humana.");
  });

  it("uses neutral content boundary wording and forbids pressure", () => {
    const entry = businessKnowledgeEntries.find((item) => item.id === "content-boundaries-neutral-question");

    expect(entry?.approvedAnswerPoints[0]).toContain("limite");
    expect(entry?.prohibitedClaims).toContain("Presionar para cambiar limites.");
  });

  it("answers transparently when asked if it is AI", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "policy_ai_identity",
      profileVisibility: "PUBLIC",
      message: "Eres una IA o un bot?"
    });

    expect(result.response).toContain("asistente virtual");
    expect(result.response).toContain("Alex supervisa");
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("call recording refusal is configured to end the call", () => {
    const entry = businessKnowledgeEntries.find((item) => item.id === "call-recording-retell-policy");

    expect(entry?.facts.join(" ")).toContain("Si no acepta");
    expect(entry?.prohibitedClaims).toContain("Continuar si rechaza la grabacion.");
  });

  it("post-call summary contains all required fields", () => {
    expect(postCallSummaryRequiredFields).toEqual([
      "name",
      "declaredAge",
      "country",
      "instagram",
      "phone",
      "experience",
      "activeOnlyFans",
      "otherAgency",
      "device",
      "availability",
      "contentProductionCapacity",
      "existingMaterial",
      "boundaries",
      "initialPercentage",
      "negotiation",
      "finalPercentage",
      "objections",
      "interestLevel",
      "specialConditions",
      "pendingQuestions",
      "recommendation",
      "nextAction",
      "recordingUrl",
      "transcript"
    ]);
  });

  it("limits follow-ups and one recovery attempt after decline", () => {
    expect(followUpPolicy.intervalDaysMin).toBe(1);
    expect(followUpPolicy.intervalDaysMax).toBe(2);
    expect(followUpPolicy.attemptsMin).toBe(2);
    expect(followUpPolicy.attemptsMax).toBe(3);
    expect(followUpPolicy.recoveryAttemptsAfterDecline).toBe(1);
    expect(followUpPolicy.sendIndefinitely).toBe(false);
  });

  it("escalates anger or scam suspicion", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "policy_scam_suspicion",
      profileVisibility: "PUBLIC",
      message: "Esto me suena a estafa y estoy enfadada"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("keeps verification and contract manual", () => {
    const entry = businessKnowledgeEntries.find((item) => item.id === "contract-questions-human-review");

    expect(entry?.facts.join(" ")).toContain("Alex verifica identidad");
    expect(entry?.prohibitedClaims).toContain("Automatizar envio de contrato.");
  });

  it("does not promise income before first month", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "policy_first_month",
      profileVisibility: "PUBLIC",
      message: "Cuando empezaria a generar ingresos?"
    });

    expect(result.response.toLowerCase()).not.toContain("vas a ganar");
    expect(result.response.toLowerCase()).not.toContain("garantizado");
  });

  it("keeps termination content-use clause under legal review", () => {
    const entry = businessKnowledgeEntries.find((item) => item.id === "contract-termination-content-use-draft");

    expect(entry?.status).toBe("DRAFT_LEGAL_REVIEW_REQUIRED");
    expect(entry?.approvedByAlex).toBe(false);
  });
});

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });

  return { engine, repository };
}
