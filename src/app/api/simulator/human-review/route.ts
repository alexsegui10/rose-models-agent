import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";

const HumanReviewSchema = z.object({
  candidateId: z.string(),
  decision: z.enum(["APPROVE", "REJECT", "REQUEST_MORE_INFO", "TAKE_OVER"]),
  note: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = HumanReviewSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();

  const existing = await repository.findCandidateById(parsed.data.candidateId);
  if (!existing) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const result = await engine.applyHumanDecision(parsed.data);
  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate: result.candidate,
    proposedMessage: result.proposedMessage,
    appliedTransitions: result.transitions,
    messages,
    transitions
  });
}
