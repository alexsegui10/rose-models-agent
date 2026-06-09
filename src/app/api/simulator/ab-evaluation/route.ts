import { NextResponse } from "next/server";
import { z } from "zod";
import { ProfileVisibilitySchema } from "@/domain/candidate";
import { ABWinnerSchema } from "@/domain/evaluation";
import { AlexStyleRatingSchema } from "@/domain/styleEvaluation";
import { runABEvaluation } from "@/application/evaluationRunner";
import { getEvaluationRepository } from "@/server/simulatorStore";

const RunABSchema = z.object({
  messages: z.array(z.string().min(1)).min(1),
  profileVisibility: ProfileVisibilitySchema.default("PUBLIC"),
  modelA: z.string().default("gpt-4.1-mini"),
  modelB: z.string().default("gpt-5.4-mini"),
  blind: z.boolean().default(true)
});

const DecisionSchema = z.object({
  id: z.string(),
  winner: ABWinnerSchema,
  styleRating: AlexStyleRatingSchema.optional(),
  note: z.string().optional()
});

export async function GET() {
  return NextResponse.json({ cases: await getEvaluationRepository().listABCases() });
}

export async function POST(request: Request) {
  const parsed = RunABSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const abCase = await runABEvaluation(parsed.data);
  await getEvaluationRepository().saveABCase(abCase);
  return NextResponse.json({ case: abCase });
}

export async function PATCH(request: Request) {
  const parsed = DecisionSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const abCase = await getEvaluationRepository().recordABDecision(parsed.data);
  return NextResponse.json({ case: abCase });
}
