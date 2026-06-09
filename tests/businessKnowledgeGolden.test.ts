import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { validateFactualResponse } from "@/application/factualValidator";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { buildResponsePlan } from "@/application/responsePlanner";
import { evaluateResponseStyle } from "@/application/styleEvaluator";
import { createCandidate, type Candidate, type ProfileVisibility } from "@/domain/candidate";
import type { ConversationExample } from "@/domain/conversationExample";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createKnowledgeEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });

  return { engine, repository };
}

describe("business knowledge golden tests", () => {
  it("answers salary questions without promising fixed income", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "salary_case",
      profileVisibility: "PUBLIC",
      message: "Trabajais con salario fijo?"
    });

    expect(result.response.toLowerCase()).toContain("salario fijo");
    expect(result.response.toLowerCase()).not.toContain("garantiz");
    expect(result.responsePlan.knowledgeEntryIds).toContain("commercial-no-fixed-salary");
    expect(result.factualValidation.valid).toBe(true);
  });

  it("answers a general percentage question without escalating", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "percentage_case",
      profileVisibility: "PUBLIC",
      message: "Que porcentaje os quedais?"
    });

    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.response.toLowerCase()).toContain("reparto");
    expect(result.response).not.toContain("70/30");
    expect(result.response).not.toContain("70%");
    expect(result.responsePlan.requiresHumanReview).toBe(false);
  });

  it("answers who receives each percentage now that revenue share is confirmed", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "split_case",
      profileVisibility: "PUBLIC",
      message: "En el 70/30 quien recibe el 70?"
    });

    expect(result.response).toContain("70%");
    expect(result.response).toContain("30%");
    expect(result.response.toLowerCase()).toContain("rose models");
    expect(result.responsePlan.requiresHumanReview).toBe(false);
  });

  it("answers what the agency does from official knowledge", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "services_case",
      profileVisibility: "PUBLIC",
      message: "Que hace la agencia exactamente?"
    });

    expect(result.response.toLowerCase()).toContain("estrategia");
    expect(result.response.toLowerCase()).toContain("monetizacion");
    expect(result.responsePlan.knowledgeEntryIds).toContain("services-agency-management");
  });

  it("answers model responsibilities from active official knowledge", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "model_work_case",
      profileVisibility: "PUBLIC",
      message: "Y que tendria que hacer yo como modelo?"
    });

    expect(result.candidate.currentState).toBe("QUALIFYING");
    expect(result.response.toLowerCase()).toContain("drive");
    expect(result.responsePlan.knowledgeEntryIds).toContain("content-model-responsibilities");
    expect(result.responsePlan.uncoveredQuestion).toBe(false);
  });

  it("answers a new covered process question using the FAQ", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "process_case",
      profileVisibility: "PUBLIC",
      message: "Como funciona el proceso?"
    });

    expect(result.response.toLowerCase()).toContain("perfil");
    expect(result.response.toLowerCase()).toContain("llamada");
    expect(result.responsePlan.knowledgeEntryIds).toContain("faq-how-it-works-covered");
  });

  it("escalates a new Rose Models question without official coverage", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "uncovered_case",
      profileVisibility: "PUBLIC",
      message: "La agencia se encarga tambien de mis impuestos?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toContain("socio");
    expect(result.responsePlan.uncoveredQuestion).toBe(true);
  });

  it("official policy wins over an old contradictory style example", async () => {
    const contradictoryExample: ConversationExample = {
      id: "old-bad-percentage",
      category: "percentage-objection",
      sourceType: "ALEX_APPROVED",
      title: "Ejemplo antiguo incorrecto",
      description: "Contradice politica actual.",
      candidateContext: {},
      stateBefore: "NEW_LEAD",
      intents: ["OTHER"],
      messages: [{ role: "candidate", content: "Que porcentaje es?" }],
      idealNextResponse: "La modelo recibe el 70% y la agencia el 30%.",
      whyItIsGood: [],
      undesirablePatterns: [],
      tags: ["percentage"],
      approvedByAlex: true,
      qualityScore: 1,
      useForGeneration: true
    };
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever([contradictoryExample])
    });

    const result = await engine.handleIncomingMessage({
      instagramUsername: "contradictory_example_case",
      profileVisibility: "PUBLIC",
      message: "En el 70/30 quien se queda cada parte?"
    });

    expect(result.response).toContain("70%");
    expect(result.response).toContain("30%");
    expect(result.response.toLowerCase()).toContain("rose models");
    expect(result.responsePlan.requiresHumanReview).toBe(false);
  });

  it("factual validation rejects invented services", () => {
    const candidate = candidateForPlan();
    const plan = buildResponsePlan({
      candidate,
      understanding: baseUnderstanding(),
      inboundMessage: "Que hace la agencia?",
      knowledgeEntries: []
    });

    const validation = validateFactualResponse("Tambien hacemos fotografias y viajes para todas las modelos.", plan);

    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((reason) => reason.includes("servicio no documentado"))).toBe(true);
  });

  it("factual validation rejects income promises", () => {
    const candidate = candidateForPlan();
    const plan = buildResponsePlan({
      candidate,
      understanding: baseUnderstanding(),
      inboundMessage: "Cuanto se gana?",
      knowledgeEntries: []
    });

    const validation = validateFactualResponse("Te garantizamos ingresos desde el primer mes.", plan);

    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((reason) => reason.includes("ingresos"))).toBe(true);
  });

  it("escalates negotiation outside authorized limits", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "negotiation_case",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% y lo hacemos?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response).not.toContain("90%");
  });

  it("escalates undocumented contract questions", async () => {
    const { engine } = createKnowledgeEngine();

    const result = await engine.handleIncomingMessage({
      instagramUsername: "contract_case",
      profileVisibility: "PUBLIC",
      message: "El contrato tiene permanencia?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.response.toLowerCase()).toContain("socio");
    expect(result.response.toLowerCase()).not.toContain("permanencia de");
  });

  it("flags correct knowledge written with bad style", () => {
    const candidate = candidateForPlan();
    const evaluation = evaluateResponseStyle(
      "Estimada candidata, procederemos a revisar tu solicitud con nuestro departamento especializado.",
      candidate,
      "Que hace la agencia?"
    );

    expect(evaluation.usesForbiddenExpression).toBe(true);
    expect(evaluation.soundsLikeAlex).toBe(false);
  });

  it("flags good style with incorrect information", () => {
    const candidate = candidateForPlan();
    const plan = buildResponsePlan({
      candidate,
      understanding: baseUnderstanding(),
      inboundMessage: "Que porcentaje es?",
      knowledgeEntries: []
    });

    const validation = validateFactualResponse("Te lo digo rapido: tu recibes el 80% y nosotros el 20%.", plan);

    expect(validation.valid).toBe(false);
    expect(validation.reasons.some((reason) => reason.includes("porcentajes"))).toBe(true);
  });
});

function candidateForPlan(): Candidate {
  return createCandidate({
    instagramUsername: "knowledge_candidate",
    profileVisibility: "PUBLIC" as ProfileVisibility
  });
}

function baseUnderstanding() {
  return ModelConversationOutputSchema.parse({
    intent: "OTHER" as const,
    extractedData: {},
    dataCorrections: [],
    dataContradictions: [],
    confidence: 0.8,
    commercialQuestionsDetected: [],
    requestsCall: false,
    requestsHuman: false,
    isNegotiation: false,
    requestedModelPercentage: null,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    internalNotes: [],
    provider: "deterministic",
    modelVersion: "deterministic-local-2026-06-08.1",
    promptVersion: "understanding-2026-06-08.1"
  });
}
