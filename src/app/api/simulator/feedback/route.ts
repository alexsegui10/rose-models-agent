import { NextResponse } from "next/server";
import { z } from "zod";
import { CandidateStateSchema } from "@/domain/candidate";
import { AlexStyleRatingSchema, ConversationFeedbackStatusSchema } from "@/domain/styleEvaluation";
import { recordConversationFeedback } from "@/application/responseFeedback";
import { getFeedbackRepository } from "@/server/simulatorStore";

const FeedbackRequestSchema = z.object({
  candidateId: z.string().min(1),
  messageId: z.string().optional(),
  status: ConversationFeedbackStatusSchema,
  originalResponse: z.string().min(1),
  editedResponse: z.string().optional(),
  reason: z.string().optional(),
  styleRating: AlexStyleRatingSchema.optional(),
  state: CandidateStateSchema,
  contextSnapshot: z.string().default(""),
  modelVersion: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = FeedbackRequestSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await recordConversationFeedback(getFeedbackRepository(), parsed.data);

  return NextResponse.json(result);
}

export async function GET() {
  const feedback = await getFeedbackRepository().listFeedback();

  return NextResponse.json({ feedback });
}
