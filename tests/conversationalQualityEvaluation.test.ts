import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import {
  parseAnonymizedConversationJson,
  approvedImportedConversationsForExamples,
  importedConversationsForEvaluation
} from "@/application/conversationImport";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import {
  addTurnFeedback,
  createEvaluationSession,
  InMemoryEvaluationRepository,
  runABEvaluation,
  summarizeSession
} from "@/application/evaluationRunner";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("CONVERSATIONAL_QUALITY_EVALUATION", () => {
  it("runs A/B with isolated memories and shared inputs", async () => {
    const abCase = await runABEvaluation({
      messages: ["Hola, quiero informacion", "Tengo 23 anos y soy de Madrid"],
      modelA: "gpt-4.1-mini",
      modelB: "gpt-5.4-mini",
      blind: true
    });

    expect(abCase.runA.model).toBe("gpt-4.1-mini");
    expect(abCase.runB.model).toBe("gpt-5.4-mini");
    expect(abCase.runA.response).toBeTruthy();
    expect(abCase.runB.response).toBeTruthy();
    expect(abCase.runA.providerTrace.actualProvider).toBe("deterministic");
    expect(abCase.runB.providerTrace.actualProvider).toBe("deterministic");
  });

  it("stores A/B human decision without selecting an automatic winner", async () => {
    const repository = new InMemoryEvaluationRepository();
    const abCase = await repository.saveABCase(
      await runABEvaluation({
        messages: ["Que porcentaje seria?"],
        modelA: "gpt-4.1-mini",
        modelB: "gpt-5.4-mini"
      })
    );

    expect(abCase.winner).toBeUndefined();
    const decided = await repository.recordABDecision({ id: abCase.id, winner: "TIE", styleRating: 4, note: "Parecidas." });
    expect(decided.winner).toBe("TIE");
    expect(decided.styleRating).toBe(4);
  });

  it("summarizes an evaluation session", () => {
    const session = createEvaluationSession({ conversationId: "conv-1", model: "gpt-5.4-mini" });
    const withFirst = addTurnFeedback(session, {
      turnIndex: 0,
      status: "APPROVED",
      originalResponse: "Ok",
      styleRating: 5,
      issues: []
    });
    const withSecond = addTurnFeedback(withFirst, {
      turnIndex: 1,
      status: "REJECTED",
      originalResponse: "Mal",
      styleRating: 2,
      issues: ["FACTUAL_ERROR", "REPETITION"]
    });

    expect(withSecond.summary?.approvedWithoutChangesPct).toBe(50);
    expect(withSecond.summary?.rejectedPct).toBe(50);
    expect(withSecond.summary?.averageStyleRating).toBe(3.5);
    expect(withSecond.summary?.factualErrors).toBe(1);
    expect(withSecond.summary?.repetitions).toBe(1);
  });

  it("includes provider cost and latency in session summary", () => {
    const summary = summarizeSession(
      "gpt-5.4-mini",
      [{ turnIndex: 0, status: "EDITED", originalResponse: "x", issues: [], styleRating: 3 }],
      [
        {
          requestedProvider: "OPENAI",
          actualProvider: "openai",
          requestedModel: "gpt-5.4-mini",
          actualModel: "gpt-5.4-mini",
          usedFallback: false,
          fallbackReason: null,
          durationMs: 100,
          retryCount: 0,
          inputTokens: 100,
          outputTokens: 20,
          estimatedCostUsd: 0.01
        }
      ]
    );

    expect(summary.editedPct).toBe(100);
    expect(summary.estimatedCostUsd).toBe(0.01);
    expect(summary.averageLatencyMs).toBe(100);
  });

  it("parses complete anonymized conversation datasets", () => {
    const file = parseAnonymizedConversationJson(
      JSON.stringify({
        version: "1",
        conversations: [
          {
            id: "complete",
            status: "ALEX_APPROVED",
            source: "ANONYMIZED_JSON",
            purpose: "EVALUATION",
            category: "qualification",
            initialState: "NEW_LEAD",
            stateBefore: "QUALIFYING",
            tags: ["quality"],
            messages: [
              {
                role: "candidate",
                content: "Hola",
                originalAlexResponse: "Hola, dime.",
                correctedResponse: "Hola, cuentame.",
                approved: true
              }
            ],
            originalAlexResponses: ["Hola, dime."],
            correctedResponses: ["Hola, cuentame."],
            approved: true,
            outcome: "scheduled_call",
            endedInCall: true,
            candidateApproved: true,
            anonymizedPersonalData: { phone: "ANON_PHONE" }
          }
        ]
      })
    );

    expect(file.conversations[0]?.category).toBe("qualification");
    expect(importedConversationsForEvaluation(file)).toHaveLength(1);
  });

  it("does not use RAW_REAL imported conversations as examples", () => {
    const file = parseAnonymizedConversationJson(
      JSON.stringify({
        version: "1",
        conversations: [
          {
            id: "raw",
            status: "RAW_REAL",
            source: "ANONYMIZED_JSON",
            purpose: "EXAMPLE",
            category: "raw",
            stateBefore: "QUALIFYING",
            messages: [{ role: "candidate", content: "Hola" }],
            idealNextResponse: "No usar"
          }
        ]
      })
    );

    expect(approvedImportedConversationsForExamples(file)).toHaveLength(0);
  });

  it("answers a non-literal covered services question from knowledge", async () => {
    const { engine } = createEngine();
    await engine.handleIncomingMessage({
      instagramUsername: "new_services_question",
      profileVisibility: "PUBLIC",
      message: "Hola"
    });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "new_services_question",
      profileVisibility: "PUBLIC",
      message: "Vosotros ayudais con estrategia para monetizar mejor la cuenta?"
    });

    expect(result.response.toLowerCase()).toContain("estrategia");
    expect(result.response.toLowerCase()).toContain("monetizacion");
    expect(result.responsePlan.knowledgeEntryIds).toContain("services-agency-management");
  });

  it("escalates a non-literal uncovered business question", async () => {
    const { engine } = createEngine();
    const result = await engine.handleIncomingMessage({
      instagramUsername: "new_uncovered_question",
      profileVisibility: "PUBLIC",
      message: "Me preparais tambien la declaracion de impuestos?"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.responsePlan.uncoveredQuestion).toBe(true);
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
