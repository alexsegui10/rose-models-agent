import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerMatches } from "@/server/bearerAuth";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { getElevenLabsOutboundConfig, startOutboundSipCall } from "@/infrastructure/integrations/elevenLabsOutbound";

export const runtime = "nodejs";

// El bot reintenta hasta 3 veces (mismo limite que recordCallOutcome); no marca un 4o.
const MAX_CALL_ATTEMPTS = 3;
const BodySchema = z.object({ candidateId: z.string().min(1), scheduledForMs: z.number().int() });

/**
 * AUTO-MARCADOR. QStash entrega esta peticion a la HORA AGENDADA (el delay se programa al cerrar la cita, ver
 * src/server/scheduleCallDispatch.ts). Dispara la llamada saliente SOLO si la cita sigue firme; nunca llama a
 * una candidata que ya no esta en CALL_SCHEDULED (cerrada/menor/reagendada a otra hora/ya atendida) ni supera
 * los 3 intentos. Contra la doble-llamada: la dedup de QStash (por candidata+hora) evita el doble-encolado y
 * `Upstash-Retries: 0` (at-most-once) evita la re-entrega; las guardas cubren el resto (una vez que un intento
 * incremente callAttempts o cambie el estado, un disparo posterior del mismo slot no vuelve a llamar).
 * Auth: bearer CRON_SECRET reenviado por QStash (igual patron que /api/instagram/flush). En MACHINE_PATHS.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 500 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { candidateId, scheduledForMs } = parsed.data;

  const config = getElevenLabsOutboundConfig();
  if (!config.isConfigured) {
    // Sin claves de ElevenLabs no se puede llamar; respondemos 200 (skipped) para que QStash NO reintente en bucle.
    return NextResponse.json({ ok: false, skipped: "elevenlabs-not-configured" });
  }

  const repository = getSimulatorRepository();
  const candidate = await repository.findCandidateById(candidateId);
  if (!candidate) {
    return NextResponse.json({ ok: false, skipped: "not-found" });
  }

  // GUARDAS: solo se llama si la cita sigue firme para ESTA hora. Cualquier otra cosa -> no-op (200, sin reintento).
  if (candidate.currentState !== "CALL_SCHEDULED") {
    return NextResponse.json({ ok: false, skipped: `state-${candidate.currentState}` });
  }
  if (candidate.scheduledCallStartMs !== scheduledForMs) {
    return NextResponse.json({ ok: false, skipped: "rescheduled" });
  }
  if (candidate.callAttempts >= MAX_CALL_ATTEMPTS) {
    return NextResponse.json({ ok: false, skipped: "max-attempts" });
  }

  const result = await startOutboundSipCall(candidate, config);
  if (!result.ok) {
    // Fallo al ARRANCAR (puede ser transitorio): 502 para que QStash reintente segun su politica.
    return NextResponse.json({ ok: false, error: result.reason ?? "No se pudo iniciar la llamada." }, { status: 502 });
  }
  // El contador se incrementa solo cuando la llamada arranco de verdad (igual que el boton manual).
  await getSimulatorEngine().noteCallAttempt(candidateId, result.conversationId ?? undefined);
  return NextResponse.json({ ok: true, conversationId: result.conversationId ?? null });
}
