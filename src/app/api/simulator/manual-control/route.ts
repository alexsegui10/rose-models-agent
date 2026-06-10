import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeCandidate } from "@/domain/candidate";
import { getSimulatorRepository } from "@/server/simulatorStore";

const ManualControlSchema = z.object({
  candidateId: z.string(),
  manualControlActive: z.boolean().default(true)
});

export async function POST(request: Request) {
  const parsed = ManualControlSchema.safeParse(await request.json());

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const repository = getSimulatorRepository();
  const candidate = await repository.findCandidateById(parsed.data.candidateId);

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const updated = await repository.saveCandidate({
    ...normalizeCandidate(candidate),
    manualControlActive: parsed.data.manualControlActive,
    automationPaused: parsed.data.manualControlActive,
    updatedAt: new Date()
  });

  return NextResponse.json({ candidate: updated });
}
