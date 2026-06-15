import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";

const AdvanceStageSchema = z.object({
  candidateId: z.string(),
  action: z.enum(["PROFILE_FIT", "PROFILE_NO_FIT", "CONFIRM_CALL", "PROFILE_OK", "REJECT"]),
  slot: z.string().optional(),
  note: z.string().optional()
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

  const result = await dispatchAction(engine, parsed.data);

  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate: result.candidate,
    proposedMessage: "proposedMessage" in result ? result.proposedMessage : null,
    appliedTransitions: result.transitions,
    messages,
    transitions
  });
}

type AdvanceStageInput = z.infer<typeof AdvanceStageSchema>;

async function dispatchAction(
  engine: ReturnType<typeof getSimulatorEngine>,
  data: AdvanceStageInput
): Promise<{
  candidate: Awaited<ReturnType<typeof engine.markProfileOk>>["candidate"];
  transitions: unknown[];
  proposedMessage?: string | null;
}> {
  switch (data.action) {
    case "CONFIRM_CALL":
      return engine.confirmScheduledCall({ candidateId: data.candidateId, slot: data.slot });
    case "PROFILE_OK":
      return engine.markProfileOk({ candidateId: data.candidateId });
    case "REJECT":
      return engine.rejectCandidate({ candidateId: data.candidateId, note: data.note });
    case "PROFILE_FIT":
    case "PROFILE_NO_FIT":
    default:
      return engine.applyProfileReviewDecision({ candidateId: data.candidateId, fits: data.action === "PROFILE_FIT" });
  }
}
