import type { Candidate } from "@/domain/candidate";
import { getQStashConfig } from "@/application/qstashConfig";
import { scheduleCallDispatch } from "@/infrastructure/integrations/qstashClient";

/**
 * Tras procesar un turno: si la candidata acaba de quedar en CALL_SCHEDULED con una hora FUTURA, programa con
 * QStash que a esa hora se dispare la llamada sola (/api/call/dispatch) — el AUTO-MARCADOR. Asi el bot llama
 * solo, sin que Alex pulse el boton. Best-effort: si QStash no esta configurado o falla, NO rompe el turno
 * (Alex siempre puede pulsar el boton a mano). La dedup por (candidata, hora) en scheduleCallDispatch evita
 * que re-encolar el mismo slot (si ella escribe otra vez) dispare dos llamadas. Un reagendado pone otra hora
 * (otra dedup-id) -> nueva programacion; el disparo viejo, al llegar, ve la hora cambiada y no llama.
 *
 * Devuelve true si se encolo el disparo (util para tests/observabilidad), false si no aplicaba o no se pudo.
 */
export async function enqueueCallDispatchIfScheduled(args: {
  candidate: Candidate;
  /** Origen absoluto de la app (new URL(request.url).origin) para construir la URL del callback. */
  origin: string;
  nowMs: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const { candidate, origin, nowMs, fetchImpl } = args;
  const env = args.env ?? process.env;
  // CALL_SCHEDULED = cita normal. CALL_NO_ANSWER = reintento diferido (recordCallOutcome reprograma la hora;
  // el dispatch lo re-lanza y noteCallAttempt re-arma a CALL_SCHEDULED al disparar).
  if (candidate.currentState !== "CALL_SCHEDULED" && candidate.currentState !== "CALL_NO_ANSWER") return false;
  const at = candidate.scheduledCallStartMs;
  if (typeof at !== "number" || at <= nowMs) return false;

  const config = getQStashConfig(env);
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!config.token || !secret) return false;

  const delaySeconds = Math.round((at - nowMs) / 1000);
  return scheduleCallDispatch({
    config,
    dispatchUrl: `${origin.replace(/\/+$/, "")}/api/call/dispatch`,
    secret,
    candidateId: candidate.id,
    scheduledForMs: at,
    delaySeconds,
    fetchImpl
  });
}
