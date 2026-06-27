import { NextResponse } from "next/server";
import { z } from "zod";
import type { ResponseDraftOutput } from "@/application/llmProvider";
import { promptRegistry } from "@/application/promptRegistry";
import { normalizeCandidate, ProfileVisibilitySchema } from "@/domain/candidate";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";

const SendMessageSchema = z
  .object({
    candidateId: z.string().optional(),
    instagramUsername: z.string().min(1),
    displayName: z.string().optional(),
    profileVisibility: ProfileVisibilitySchema.optional(),
    // La candidata puede mandar uno o varios mensajes seguidos: el motor los agrupa en un turno.
    message: z.string().min(1).optional(),
    messages: z.array(z.string().min(1)).optional(),
    externalMessageId: z.string().optional()
  })
  .refine((data) => Boolean(data.message) || (data.messages?.length ?? 0) > 0, {
    message: "Se requiere 'message' o 'messages'."
  });

export async function POST(request: Request) {
  const parsed = SendMessageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();
  const { message, messages: inputMessages, externalMessageId, ...lookup } = parsed.data;
  const turnMessages =
    inputMessages && inputMessages.length > 0
      ? inputMessages.map((content) => ({ content }))
      : [{ content: message as string, externalMessageId }];
  const result = await engine.handleIncomingTurn({ ...lookup, messages: turnMessages });
  const candidate = await repository.saveCandidate(normalizeCandidate(result.candidate));
  // AUTO-MARCADOR: si este turno dejo la cita agendada, programa la llamada automatica a esa hora (best-effort:
  // si QStash no esta o falla, no rompe el turno; Alex siempre puede pulsar el boton de llamar a mano).
  try {
    await enqueueCallDispatchIfScheduled({ candidate, origin: new URL(request.url).origin, nowMs: Date.now() });
  } catch {
    /* best-effort */
  }
  const draft = result.draft ?? missingDraftTrace(result.response);
  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate,
    response: result.response,
    duplicate: result.duplicate,
    automationBlocked: result.automationBlocked,
    automationMode: result.automationMode,
    deliveryStatus: result.deliveryStatus,
    draft,
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

function missingDraftTrace(response: string): ResponseDraftOutput {
  return {
    response,
    provider: "unknown",
    modelVersion: "unknown",
    promptVersion: promptRegistry.drafting.version,
    usedFallback: true,
    requestedProvider: "UNKNOWN",
    actualProvider: "unknown",
    requestedModel: "unknown",
    actualModel: "unknown",
    fallbackReason: "missing-draft-trace",
    durationMs: 0,
    retryCount: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    error: "La respuesta no incluia trazas de generacion."
  };
}
