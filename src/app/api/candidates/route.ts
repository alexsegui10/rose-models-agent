import { NextResponse } from "next/server";
import { recoverStuckCalls } from "@/application/callWatchdog";
import { normalizeCandidate } from "@/domain/candidate";
import { getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Lista de candidatas para el CRM. SOLO LECTURA (jul-2026): antes re-ESCRIBÍA todas las filas en cada poll
 * de 5s (upsert por candidata) — carga inútil en Neon y, peor, una carrera real: el poll podía pisar con
 * datos viejos una escritura concurrente (webhook de fin de llamada, turno de IG). La normalización se
 * aplica solo en la respuesta; quien persiste normalizado es quien escribe.
 *
 * Excepción quirúrgica (A1 jul-2026): el WATCHDOG de llamadas atascadas corre aquí de forma oportunista
 * (throttled a 1 vez/5 min por instancia) porque el cron de Vercel es solo diario. Escribe SOLO a la
 * candidata atascada en CALL_IN_PROGRESS sin webhook de fin (caso raro), nunca el upsert masivo de antes.
 */

const WATCHDOG_MIN_INTERVAL_MS = 5 * 60 * 1000;
let lastWatchdogRunMs = 0;

export async function GET(request: Request) {
  const repository = getSimulatorRepository();
  let candidates = await repository.listCandidates();

  const now = Date.now();
  if (now - lastWatchdogRunMs > WATCHDOG_MIN_INTERVAL_MS) {
    lastWatchdogRunMs = now;
    try {
      const notifier = getOperatorNotifier();
      const recovered = await recoverStuckCalls({
        repository,
        candidates,
        notify: (r) =>
          notifier.notify({
            kind: "call-watchdog",
            conversationId: r.instagramUsername,
            detail: r.detail
          })
      });
      // Cita vencida re-armada: re-encolar el auto-marcador con la NUEVA hora (la entrega vieja de
      // QStash, si llega, ve la hora cambiada y no llama). Best-effort: si falla, ya se avisó a Alex.
      for (const r of recovered) {
        if (r.kind === "MISSED_DISPATCH" && r.rearmed) {
          await enqueueCallDispatchIfScheduled({
            candidate: r.rearmed,
            origin: new URL(request.url).origin,
            nowMs: Date.now()
          });
        }
      }
      if (recovered.length > 0) {
        // La lista ya cargada quedó vieja para las recuperadas: se relee para que el CRM pinte el estado real.
        candidates = await repository.listCandidates();
      }
    } catch (error) {
      // El watchdog jamás rompe el CRM.
      console.error("[candidates] watchdog fallo (se sirve la lista igualmente)", {
        error: error instanceof Error ? error.name : "unknown"
      });
    }
  }

  return NextResponse.json({ candidates: candidates.map((candidate) => normalizeCandidate(candidate)) });
}
