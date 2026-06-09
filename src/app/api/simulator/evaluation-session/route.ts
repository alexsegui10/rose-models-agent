import { NextResponse } from "next/server";
import { z } from "zod";
import { EvaluationIssueSchema } from "@/domain/evaluation";
import { AlexStyleRatingSchema, ConversationFeedbackStatusSchema } from "@/domain/styleEvaluation";
import { addTurnFeedback, createEvaluationSession } from "@/application/evaluationRunner";
import { getEvaluationRepository } from "@/server/simulatorStore";

const CreateSessionSchema = z.object({
  conversationId: z.string().min(1),
  model: z.string().default("gpt-5.4-mini")
});

const TurnFeedbackSchema = z.object({
  sessionId: z.string().min(1),
  turnIndex: z.number().int().nonnegative(),
  status: ConversationFeedbackStatusSchema,
  originalResponse: z.string().min(1),
  editedResponse: z.string().optional(),
  styleRating: AlexStyleRatingSchema.optional(),
  issues: z.array(EvaluationIssueSchema).default([]),
  note: z.string().optional()
});

export async function GET() {
  return NextResponse.json({ sessions: await getEvaluationRepository().listSessions() });
}

export async function POST(request: Request) {
  const parsed = CreateSessionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const session = await getEvaluationRepository().saveSession(createEvaluationSession(parsed.data));
  return NextResponse.json({ session });
}

export async function PATCH(request: Request) {
  const parsed = TurnFeedbackSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await getEvaluationRepository().getSession(parsed.data.sessionId);
  if (!existing) {
    return NextResponse.json({ error: "Evaluation session not found." }, { status: 404 });
  }

  const updated = addTurnFeedback(existing, {
    turnIndex: parsed.data.turnIndex,
    status: parsed.data.status,
    originalResponse: parsed.data.originalResponse,
    editedResponse: parsed.data.editedResponse,
    styleRating: parsed.data.styleRating,
    issues: parsed.data.issues,
    note: parsed.data.note
  });
  await getEvaluationRepository().saveSession(updated);
  return NextResponse.json({ session: updated });
}
