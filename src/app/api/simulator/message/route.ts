import { NextResponse } from "next/server";
import { z } from "zod";
import { ProfileVisibilitySchema } from "@/domain/candidate";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";

const SendMessageSchema = z.object({
  candidateId: z.string().optional(),
  instagramUsername: z.string().min(1),
  displayName: z.string().optional(),
  profileVisibility: ProfileVisibilitySchema.optional(),
  message: z.string().min(1),
  externalMessageId: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = SendMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();
  const result = await engine.handleIncomingMessage(parsed.data);
  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate: result.candidate,
    response: result.response,
    duplicate: result.duplicate,
    automationBlocked: result.automationBlocked,
    automationMode: result.automationMode,
    deliveryStatus: result.deliveryStatus,
    draft: result.draft,
    contradictions: result.contradictions,
    corrections: result.corrections,
    understanding: result.understanding,
    knowledgeEntries: result.knowledgeEntries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      title: entry.title,
      version: entry.version,
      requiresHumanReview: entry.requiresHumanReview
    })),
    responsePlan: {
      objective: result.responsePlan.objective,
      knowledgeEntryIds: result.responsePlan.knowledgeEntryIds,
      knowledgeVersions: result.responsePlan.knowledgeVersions,
      revenueSharePolicyVersion: result.responsePlan.revenueSharePolicyVersion,
      requiresHumanReview: result.responsePlan.requiresHumanReview,
      humanReviewReason: result.responsePlan.humanReviewReason,
      uncoveredQuestion: result.responsePlan.uncoveredQuestion
    },
    factualValidation: result.factualValidation,
    retrievedExamples: result.retrievedExamples.map((example) => ({
      id: example.id,
      title: example.title,
      category: example.category,
      tags: example.tags,
      qualityScore: example.qualityScore,
      whyItIsGood: example.whyItIsGood
    })),
    styleEvaluation: result.styleEvaluation,
    styleContext: {
      promptVersion: result.styleContext.promptVersion,
      styleProfileVersion: result.styleContext.styleProfileVersion,
      rulesVersion: result.styleContext.rulesVersion,
      retrieverVersion: result.styleContext.retrieverVersion,
      modelVersion: result.styleContext.modelVersion
    },
    messages,
    transitions
  });
}
