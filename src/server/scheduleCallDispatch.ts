import type { Candidate } from "@/domain/candidate";
import { getQStashConfig } from "@/application/qstashConfig";
import { scheduleCallDispatch } from "@/infrastructure/integrations/qstashClient";
import { getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";

/**
 * Tras procesar un turno: si la candidata acaba de quedar en CALL_SCHEDULED con una hora FUTURA, programa con
 * QStash que a esa hora se dispare la llamada sola (/api/call/dispatch) — el AUTO-MARCADOR. Asi el bot llama
 * solo, sin que Alex pulse el boton. Best-effort: si QStash no esta configurado o falla, NO rompe el turno
 * (Alex siempre puede pulsar el boton a mano)… pero YA NO es silencioso (jul-2026, hallazgo agenda-03): una
 * cita confirmada a la candidata SIN auto-marcador armado es una llamada que no saldra sola, asi que se avisa
 * a Alex por el notificador (WhatsApp) para que la haga a mano. La dedup por (candidata, hora) en
 * scheduleCallDispatch evita que re-encolar el mismo slot (si ella escribe otra vez) dispare dos llamadas. Un
 * reagendado pone otra hora (otra dedup-id) -> nueva programacion; el disparo viejo, al llegar, ve la hora
 * cambiada y no llama.
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
  if (!config.token || !secret) {
    await warnAutoDialerDown(candidate, "QStash/CRON_SECRET sin configurar");
    return false;
  }

  const delaySeconds = Math.round((at - nowMs) / 1000);
  let enqueued = false;
  try {
    enqueued = await scheduleCallDispatch({
      config,
      dispatchUrl: `${origin.replace(/\/+$/, "")}/api/call/dispatch`,
      secret,
      candidateId: candidate.id,
      scheduledForMs: at,
      delaySeconds,
      fetchImpl
    });
  } catch {
    enqueued = false;
  }
  if (!enqueued) {
    await warnAutoDialerDown(candidate, "QStash no acepto el encolado");
  }
  return enqueued;
}

// Dedup de avisos por (candidata, hora) en el proceso: si ella escribe 5 veces con la cita ya rota, Alex
// recibe UN aviso, no cinco. (Entre lambdas distintas puede repetirse alguno: preferible a perder el aviso.)
const warnedSlots = new Set<string>();

/** Aviso a Alex (best-effort, nunca lanza): la cita quedo confirmada pero la llamada NO saldra sola. */
async function warnAutoDialerDown(candidate: Candidate, detail: string): Promise<void> {
  const slotKey = `${candidate.id}@${candidate.scheduledCallStartMs ?? "?"}`;
  if (warnedSlots.has(slotKey)) return;
  warnedSlots.add(slotKey);
  if (warnedSlots.size > 500) warnedSlots.clear();
  console.error("[auto-marcador] cita agendada SIN auto-marcador: la llamada NO saldra sola", {
    candidateId: candidate.id,
    scheduledCallStartMs: candidate.scheduledCallStartMs,
    detail
  });
  try {
    await getOperatorNotifier().notify({
      kind: "error",
      conversationId: candidate.instagramUsername,
      state: candidate.currentState,
      reason: "Cita agendada SIN auto-marcador: llámala tú a la hora (botón Llamar del CRM).",
      detail
    });
  } catch {
    // El aviso nunca rompe el turno.
  }
}
