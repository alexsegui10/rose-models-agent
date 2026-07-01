import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { deliverDecisionOutcome } from "@/server/resumeReprocess";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";

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

  // La accion NO se pudo aplicar por falta de datos (p.ej. confirmar llamada sin telefono/hora): no hay nada que
  // entregar; se devuelve el motivo para que el CRM lo muestre a Alex (no un "hecho" falso). Estado intacto.
  if (result.blockedReason) {
    return NextResponse.json({
      candidate: result.candidate,
      proposedMessage: null,
      sentToCandidate: null,
      blockedReason: result.blockedReason,
      appliedTransitions: [],
      messages: await repository.listMessages(result.candidate.id),
      transitions: await repository.listTransitions(result.candidate.id)
    });
  }

  // Entregar a la candidata, por su canal (Instagram/WhatsApp), lo que la decision haya generado (p.ej. al
  // completar el par perfil+movil, "Buenas noticias... ¿que dia te viene?"). Si escribio DURANTE la pausa,
  // el bot RESPONDE a eso (reproceso) en vez del proactivo fijo. El motor ya guardo el mensaje; aqui se envia.
  // La decision YA se aplico y persistio; un fallo al ENTREGAR (reproceso/envio) no debe dar 500.
  let outcome: Awaited<ReturnType<typeof deliverDecisionOutcome>>;
  let deliveryError = false;
  try {
    outcome = await deliverDecisionOutcome(engine, {
      candidate: result.candidate,
      proposedMessage: result.proposedMessage ?? null,
      reprocessTrailingInbound: result.reprocessTrailingInbound ?? null
    });
  } catch (error) {
    console.warn("[advance-stage] fallo al entregar tras la decision", {
      error: error instanceof Error ? error.name : "desconocido"
    });
    outcome = { candidate: result.candidate, proposedMessage: result.proposedMessage ?? null, sentToCandidate: null };
    deliveryError = true;
  }

  // AUTO-MARCADOR (jul-2026, hallazgo agenda-01): "Confirmar llamada" / decisiones que agendan (o cuyo
  // reproceso agenda) deben ARMAR el disparo diferido, igual que el webhook de IG. Sin esto, la cita
  // confirmada desde el CRM no sonaba sola. Best-effort (avisa a Alex si falla).
  await enqueueCallDispatchIfScheduled({
    candidate: outcome.candidate,
    origin: new URL(request.url).origin,
    nowMs: Date.now()
  });

  const messages = await repository.listMessages(outcome.candidate.id);
  const transitions = await repository.listTransitions(outcome.candidate.id);

  return NextResponse.json({
    candidate: outcome.candidate,
    proposedMessage: outcome.proposedMessage,
    sentToCandidate: outcome.sentToCandidate,
    deliveryError,
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
  reprocessTrailingInbound?: string[] | null;
  blockedReason?: string;
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
