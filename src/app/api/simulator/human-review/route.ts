import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { deliverProactiveMessage } from "@/server/proactiveDelivery";

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
  // Entregar el mensaje del bot (p.ej. "Buenas noticias... ¿que dia te viene?") a la candidata por su canal
  // (Instagram/WhatsApp). El motor ya lo guardo; aqui SOLO se envia (antes no salia a Instagram).
  const delivery = result.proposedMessage ? await deliverProactiveMessage(result.candidate, result.proposedMessage) : null;
  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate: result.candidate,
    proposedMessage: result.proposedMessage,
    sentToCandidate: delivery,
    appliedTransitions: result.transitions,
    messages,
    transitions
  });
}
