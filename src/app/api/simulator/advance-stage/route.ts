import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { deliverProactiveMessage } from "@/server/proactiveDelivery";

const AdvanceStageSchema = z.object({
  candidateId: z.string(),
  action: z.enum([
    "PROFILE_FIT",
    "PROFILE_NO_FIT",
    "CONFIRM_CALL",
    "PROFILE_OK",
    "REJECT",
    "FOLLOW_REQUEST_SENT",
    "DEVICE_APPROVE",
    "DEVICE_REJECT"
  ]),
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

  // Entregar a la candidata, por su canal (Instagram/WhatsApp), el mensaje del bot que la decision haya
  // generado (p.ej. al aprobar el movil y completarse el par, "Buenas noticias... ¿que dia te viene?").
  // El motor ya lo guardo; aqui SOLO se envia (antes las decisiones del CRM no salian a Instagram).
  const proposedMessage = "proposedMessage" in result ? result.proposedMessage : null;
  const delivery = proposedMessage ? await deliverProactiveMessage(result.candidate, proposedMessage) : null;

  const messages = await repository.listMessages(result.candidate.id);
  const transitions = await repository.listTransitions(result.candidate.id);

  return NextResponse.json({
    candidate: result.candidate,
    proposedMessage,
    sentToCandidate: delivery,
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
    case "FOLLOW_REQUEST_SENT":
      return engine.markFollowRequestSent({ candidateId: data.candidateId });
    case "REJECT":
      return engine.rejectCandidate({ candidateId: data.candidateId, note: data.note });
    case "DEVICE_APPROVE":
    case "DEVICE_REJECT":
      return engine.applyDeviceQualityDecision({ candidateId: data.candidateId, approved: data.action === "DEVICE_APPROVE" });
    case "PROFILE_FIT":
    case "PROFILE_NO_FIT":
    default:
      return engine.applyProfileReviewDecision({ candidateId: data.candidateId, fits: data.action === "PROFILE_FIT" });
  }
}
