import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { deliverDecisionOutcome } from "@/server/resumeReprocess";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";

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
  // aqui SOLO se envia (antes las decisiones del CRM no salian a Instagram). La decision YA se persistio:
  // un fallo al ENTREGAR no debe dar 500 ni dejar el CRM en error con la candidata ya avanzada.
  let outcome: Awaited<ReturnType<typeof deliverDecisionOutcome>>;
  let deliveryError = false;
  try {
    outcome = await deliverDecisionOutcome(engine, result);
  } catch (error) {
    console.warn("[human-review] fallo al entregar tras la decision", {
      error: error instanceof Error ? error.name : "desconocido"
    });
    outcome = { candidate: result.candidate, proposedMessage: result.proposedMessage ?? null, sentToCandidate: null };
    deliveryError = true;
  }
  // AUTO-MARCADOR (jul-2026, hallazgo agenda-01): si la decision/reproceso dejo la cita agendada (ella dio
  // hora+telefono durante la pausa), hay que ARMAR el disparo diferido igual que hace el webhook de IG.
  // Sin esto, la llamada "agendada" desde el CRM no salia sola. Best-effort (avisa a Alex si falla).
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
