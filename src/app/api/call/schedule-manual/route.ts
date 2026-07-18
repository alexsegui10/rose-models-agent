import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";
import { sameOriginAllowed } from "@/application/sameOrigin";

export const runtime = "nodejs";

// Agendado MANUAL de la llamada (peticion de Alex 18-jul): Alex pauso el bot, termino la conversacion a
// mano, y desde la web elige candidata + dia/hora reales. La logica vive en el motor
// (scheduleCallManually: Encaja implicito + CALL_SCHEDULED + auto-marcador); la ruta es fina.

const ScheduleManualSchema = z.object({
  candidateId: z.string().min(1),
  // Instante UTC en ms (la UI lo calcula desde el picker local de Alex).
  startMsUtc: z.number().int().positive(),
  phone: z.string().trim().min(5).optional()
});

export async function POST(request: Request) {
  // Programa una llamada de PAGO a un numero que puede venir en el body: mismo guard de origen que
  // /api/call/test (revisor 18-jul) — solo desde la propia web del CRM.
  if (!sameOriginAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  }
  const parsed = ScheduleManualSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();

  const existing = await repository.findCandidateById(parsed.data.candidateId);
  if (!existing) {
    return NextResponse.json({ error: "Candidata no encontrada." }, { status: 404 });
  }

  const result = await engine.scheduleCallManually(parsed.data);
  if (result.blockedReason) {
    return NextResponse.json({ candidate: result.candidate, blockedReason: result.blockedReason });
  }

  // Arma el disparo diferido del auto-marcador (mismo mecanismo que el resto de agendados).
  await enqueueCallDispatchIfScheduled({
    candidate: result.candidate,
    origin: new URL(request.url).origin,
    nowMs: Date.now()
  });

  return NextResponse.json({
    candidate: result.candidate,
    appliedTransitions: result.transitions,
    blockedReason: null
  });
}
