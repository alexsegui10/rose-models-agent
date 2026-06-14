import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";

const AdvanceStageSchema = z.object({
  candidateId: z.string(),
  action: z.enum(["PROFILE_FIT", "PROFILE_NO_FIT", "CONFIRM_CALL"]),
  slot: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = AdvanceStageSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();

  const existing = await repository.findCandidateById(parsed.data.candidateId);
  if (!existing) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const result =
    parsed.data.action === "CONFIRM_CALL"
      ? await engine.confirmScheduledCall({ candidateId: parsed.data.candidateId, slot: parsed.data.slot })
      : await engine.applyProfileReviewDecision({
          candidateId: parsed.data.candidateId,
          fits: parsed.data.action === "PROFILE_FIT"
        });

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
