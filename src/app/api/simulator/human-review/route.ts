import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { deliverDecisionOutcome } from "@/server/resumeReprocess";

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
  // Entregar a la candidata, por su canal (Instagram/WhatsApp), lo que toque: si escribio DURANTE la pausa,
  // el bot RESPONDE a eso (reproceso); si no, el proactivo fijo de aprobado. El motor ya guardo el mensaje;
  // aqui SOLO se envia (antes las decisiones del CRM no salian a Instagram).
  const outcome = await deliverDecisionOutcome(engine, result);
  const messages = await repository.listMessages(outcome.candidate.id);
  const transitions = await repository.listTransitions(outcome.candidate.id);

  return NextResponse.json({
    candidate: outcome.candidate,
    proposedMessage: outcome.proposedMessage,
    sentToCandidate: outcome.sentToCandidate,
    appliedTransitions: result.transitions,
    messages,
    transitions
  });
}
