import type { Candidate } from "@/domain/candidate";
import { canTransition, createTransition } from "@/domain/stateMachine";
import type { CandidateRepository } from "@/infrastructure/repositories/types";
import { candidateLocalHour, candidateZoneFromPhone } from "./callScheduling";

/**
 * WATCHDOG de llamadas (A1, jul-2026). Dos barridos deterministas y conservadores:
 *
 * 1) CALL_IN_PROGRESS atascada: si el webhook de FIN nunca llega (caída de ElevenLabs, quota agotada a
 *    mitad de llamada — pasó en la llamada real del 2-jul), la candidata quedaba "en curso" para siempre.
 *    Se re-arma a CALL_NO_ANSWER (la maquinaria de reintento existente toma el relevo) y se avisa a Alex.
 *
 * 2) Cita VENCIDA sin marcar (lanzamiento 3-jul, caso Ana): la cita quedó confirmada a la candidata pero
 *    el auto-marcador nunca disparó (encolado QStash perdido / fallo silencioso). Como noteCallAttempt
 *    mueve a CALL_IN_PROGRESS al marcar, una candidata que sigue en CALL_SCHEDULED/CALL_NO_ANSWER con la
 *    hora vencida >15 min significa que NO hubo llamada: re-armar es seguro. Se reprograma a now+5min y
 *    el LLAMANTE re-encola el auto-marcador con la nueva hora (la entrega vieja de QStash, si llega, ve
 *    la hora cambiada y el guard "rescheduled" del dispatch no llama: sin dobles llamadas). Guardas:
 *    respeta control manual/pausa de Alex, el límite de 3 intentos, la franja 9-22 LOCAL de la candidata
 *    (zona por prefijo: nada de llamadas de madrugada), tope de 3 re-armados (sin bucles si QStash sigue
 *    caído) y citas vencidas >24h NO se re-arman (solo nota + aviso: nadie llama un día después de la
 *    nada — Alex decide).
 *
 * No toca callAttempts (eso es de noteCallAttempt al marcar) y respeta la máquina de estados (invariante 1).
 */

// 20 min: máximo real de llamada (420 s) + margen amplio para webhooks lentos.
export const STUCK_CALL_THRESHOLD_MS = 20 * 60 * 1000;

// Cita vencida sin marcar: umbral (15 min tras la hora agendada), reintento (now+5min), edad máxima
// re-armable (24h) y tope de re-armados automáticos.
export const MISSED_DISPATCH_THRESHOLD_MS = 15 * 60 * 1000;
export const MISSED_DISPATCH_RETRY_DELAY_MS = 5 * 60 * 1000;
export const MISSED_DISPATCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_REARMS = 3;
// Franja local de la candidata en la que el re-armado puede disparar una llamada (9:00-21:59).
const LOCAL_CALL_WINDOW = { from: 9, to: 22 };

// Marcadores en notes: dan trazabilidad y son el contador/dedupe de los barridos.
const REARM_NOTE_MARKER = "WATCHDOG-DISPATCH";
const EXPIRED_NOTE_MARKER = "WATCHDOG-DISPATCH-VENCIDA";
// El bot reintenta hasta 3 veces (mismo límite que recordCallOutcome y /api/call/dispatch).
const MAX_CALL_ATTEMPTS = 3;

export interface StuckCallRecovery {
  candidateId: string;
  instagramUsername: string;
  minutesStuck: number;
  kind: "IN_PROGRESS_STUCK" | "MISSED_DISPATCH" | "MISSED_DISPATCH_EXPIRED";
  /** Texto listo para el aviso a Alex (cada kind cuenta una historia distinta). */
  detail: string;
  /** Candidata YA re-armada (solo MISSED_DISPATCH): el llamante re-encola el auto-marcador con su nueva hora. */
  rearmed?: Candidate;
}

export async function recoverStuckCalls(args: {
  repository: CandidateRepository;
  now?: Date;
  /** Lista ya cargada (p. ej. la del propio GET del CRM) para no repetir la consulta. */
  candidates?: Candidate[];
  /** Aviso a Alex (best-effort: si falla, la recuperación sigue). */
  notify?: (recovered: StuckCallRecovery) => Promise<void>;
}): Promise<StuckCallRecovery[]> {
  const now = args.now ?? new Date();
  const candidates = args.candidates ?? (await args.repository.listCandidates());
  const recovered: StuckCallRecovery[] = [];

  for (const stale of candidates) {
    const isInProgress = stale.currentState === "CALL_IN_PROGRESS";
    const isAwaitingDial = stale.currentState === "CALL_SCHEDULED" || stale.currentState === "CALL_NO_ANSWER";
    if (!isInProgress && !isAwaitingDial) continue;
    // Anti-carrera (riesgo del revisor): la lista puede venir cargada de antes — se RE-LEE por id y se
    // re-comprueba el estado justo antes de escribir, para no pisar un webhook de fin (o un dispatch que
    // acaba de marcar) que aterrizara entre la lectura y el guardado. Ventana residual de ms, aceptada (P1-4).
    const candidate = (await args.repository.findCandidateById(stale.id)) ?? stale;

    const recovery =
      candidate.currentState === "CALL_IN_PROGRESS"
        ? await recoverInProgressStuck(args.repository, candidate, now)
        : await recoverMissedDispatch(args.repository, candidate, now);
    if (!recovery) continue;

    recovered.push(recovery);
    try {
      await args.notify?.(recovery);
    } catch {
      // El aviso jamás bloquea la recuperación (best-effort).
    }
    console.log("[call-watchdog] recuperación aplicada", {
      candidateId: recovery.candidateId,
      kind: recovery.kind,
      minutesStuck: recovery.minutesStuck
    });
  }

  return recovered;
}

// Barrido 1: llamada "en curso" sin webhook de fin -> CALL_NO_ANSWER (reintento normal).
async function recoverInProgressStuck(
  repository: CandidateRepository,
  candidate: Candidate,
  now: Date
): Promise<StuckCallRecovery | null> {
  const sinceMs = now.getTime() - new Date(candidate.updatedAt).getTime();
  if (sinceMs < STUCK_CALL_THRESHOLD_MS) return null;
  if (!canTransition("CALL_IN_PROGRESS", "CALL_NO_ANSWER")) return null;

  const minutesStuck = Math.round(sinceMs / 60_000);
  const note =
    `WATCHDOG (${now.toISOString()}): llamada "en curso" desde hace ${minutesStuck} min sin webhook de fin ` +
    "(posible caída del proveedor de voz o créditos agotados a mitad de llamada). Re-armada como NO CONTESTA " +
    "para que el reintento normal siga su curso.";
  const transition = createTransition({
    candidate,
    toState: "CALL_NO_ANSWER",
    trigger: "CALL_WATCHDOG",
    reason: `Watchdog: sin fin de llamada tras ${minutesStuck} min; se re-arma para reintento.`
  });
  await repository.saveCandidate({
    ...candidate,
    currentState: "CALL_NO_ANSWER",
    notes: [...candidate.notes, note],
    updatedAt: now
  });
  await repository.addTransition(transition);

  return {
    candidateId: candidate.id,
    instagramUsername: candidate.instagramUsername,
    minutesStuck,
    kind: "IN_PROGRESS_STUCK",
    detail: `${minutesStuck} min en curso sin fin de llamada; re-armada para reintento.`
  };
}

// Barrido 2: cita vencida sin marcar -> reprogramar a now+5min (o solo avisar si es muy vieja).
async function recoverMissedDispatch(
  repository: CandidateRepository,
  candidate: Candidate,
  now: Date
): Promise<StuckCallRecovery | null> {
  const at = candidate.scheduledCallStartMs;
  if (typeof at !== "number") return null;
  const overdueMs = now.getTime() - at;
  if (overdueMs < MISSED_DISPATCH_THRESHOLD_MS) return null;
  // Alex tomó el control o pausó: él decide, el watchdog no re-arma llamadas por su cuenta.
  if (candidate.manualControlActive || candidate.automationPaused) return null;
  if (candidate.callAttempts >= MAX_CALL_ATTEMPTS) return null;

  const minutesOverdue = Math.round(overdueMs / 60_000);

  // Cita vencida hace más de 24h: llamarla "de la nada" un día después sería peor que el fallo. Nota +
  // aviso UNA vez (el marcador dedupea) y la decisión queda para Alex (botón Llamar del CRM).
  if (overdueMs > MISSED_DISPATCH_MAX_AGE_MS) {
    if (candidate.notes.some((note) => note.includes(EXPIRED_NOTE_MARKER))) return null;
    const note =
      `${EXPIRED_NOTE_MARKER} (${now.toISOString()}): la cita agendada quedó sin marcar y venció hace ` +
      `${Math.round(overdueMs / 3_600_000)}h. No se re-arma automáticamente (demasiado vieja): decide tú desde el CRM.`;
    await repository.saveCandidate({ ...candidate, notes: [...candidate.notes, note], updatedAt: now });
    return {
      candidateId: candidate.id,
      instagramUsername: candidate.instagramUsername,
      minutesStuck: minutesOverdue,
      kind: "MISSED_DISPATCH_EXPIRED",
      detail: "Cita vencida hace más de 24h SIN llamar: llámala tú desde el CRM (no se re-arma sola)."
    };
  }

  // Tope de re-armados automáticos: si el auto-marcador sigue sin disparar tras 3 re-intentos del
  // watchdog, insistir solo generaría spam de avisos (Alex ya recibió 3 con instrucciones). Anclado a
  // "MARKER (" para que una nota VENCIDA (cuyo marcador contiene este) no consuma re-armados (revisor 4-jul).
  const previousRearms = candidate.notes.filter((note) => note.includes(`${REARM_NOTE_MARKER} (`)).length;
  if (previousRearms >= MAX_AUTO_REARMS) return null;

  // Franja 9-22 LOCAL de la candidata (zona por prefijo): un re-armado a las 3 AM suyas esperaría al
  // siguiente barrido dentro de la franja (la condición de vencida sigue viva).
  const rearmAtMs = now.getTime() + MISSED_DISPATCH_RETRY_DELAY_MS;
  const localHour = candidateLocalHour(rearmAtMs, candidateZoneFromPhone(candidate.phone));
  if (localHour < LOCAL_CALL_WINDOW.from || localHour >= LOCAL_CALL_WINDOW.to) return null;

  // Cierre extra de la ventana de carrera (revisor 4-jul): una entrega vieja de QStash que marque JUSTO
  // durante este barrido mueve a CALL_IN_PROGRESS y sube callAttempts; si escribiéramos el snapshot de
  // antes, revertiríamos ese marcado y la nueva entrega llamaría OTRA VEZ. Re-leemos inmediatamente antes
  // de guardar y abortamos si algo cambió (queda la ventana de ms teórica, familia P1-4, sin consecuencia
  // aquí porque el dispatch re-verifica estado/hora/intentos en la entrega).
  const fresh = await repository.findCandidateById(candidate.id);
  if (
    !fresh ||
    fresh.currentState !== candidate.currentState ||
    fresh.scheduledCallStartMs !== candidate.scheduledCallStartMs ||
    fresh.callAttempts !== candidate.callAttempts
  ) {
    return null;
  }

  const note =
    `${REARM_NOTE_MARKER} (${now.toISOString()}): la llamada agendada no salió (auto-marcador sin disparar ` +
    `${minutesOverdue} min después de la hora). Reprogramada a ${new Date(rearmAtMs).toISOString()} y re-encolado el marcador ` +
    `(re-armado ${previousRearms + 1}/${MAX_AUTO_REARMS}).`;
  const rearmed: Candidate = {
    ...fresh,
    scheduledCallStartMs: rearmAtMs,
    notes: [...fresh.notes, note],
    updatedAt: now
  };
  await repository.saveCandidate(rearmed);

  return {
    candidateId: candidate.id,
    instagramUsername: candidate.instagramUsername,
    minutesStuck: minutesOverdue,
    kind: "MISSED_DISPATCH",
    detail: `La llamada agendada no salió (${minutesOverdue} min de retraso); reprogramada a +5 min. Si no suena, llámala tú.`,
    rearmed
  };
}
