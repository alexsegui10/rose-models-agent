import type { Candidate } from "@/domain/candidate";
import { canTransition, createTransition } from "@/domain/stateMachine";
import type { CandidateRepository } from "@/infrastructure/repositories/types";

/**
 * WATCHDOG de llamadas atascadas (A1, jul-2026). Si el webhook de FIN de llamada nunca llega (caída de
 * ElevenLabs, quota agotada a mitad de llamada — pasó en la llamada real del 2-jul), la candidata se
 * quedaba en CALL_IN_PROGRESS para siempre: el auto-marcador no reintenta (ve "en curso") y Alex no se
 * entera. Este barrido re-arma a CALL_NO_ANSWER (la maquinaria de reintento existente toma el relevo:
 * hasta 3 intentos y re-enganche por IG) y avisa a Alex.
 *
 * DETERMINISTA y conservador: umbral muy por encima de la duración máxima real de una llamada (el agente
 * corta a los 7 min por config), así que a los 20 min "en curso" ya no hay llamada de verdad. No toca
 * callAttempts (eso es de noteCallAttempt al marcar) y respeta la máquina de estados (invariante 1).
 * Un webhook MUY tardío que llegara después encontraría CALL_NO_ANSWER: recordCallOutcome solo registra
 * desde CALL_SCHEDULED/CALL_IN_PROGRESS, así que no pisa la recuperación (y el reintento re-arma).
 */

// 20 min: máximo real de llamada (420 s) + margen amplio para webhooks lentos.
export const STUCK_CALL_THRESHOLD_MS = 20 * 60 * 1000;

export interface StuckCallRecovery {
  candidateId: string;
  instagramUsername: string;
  minutesStuck: number;
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
    if (stale.currentState !== "CALL_IN_PROGRESS") continue;
    // Anti-carrera (riesgo del revisor): la lista puede venir cargada de antes — se RE-LEE por id y se
    // re-comprueba el estado justo antes de escribir, para no pisar un webhook de fin que aterrizara
    // entre la lectura y el guardado (perdería lastCall/estado). Ventana residual de ms, aceptada (P1-4).
    const candidate = (await args.repository.findCandidateById(stale.id)) ?? stale;
    if (candidate.currentState !== "CALL_IN_PROGRESS") continue;
    const sinceMs = now.getTime() - new Date(candidate.updatedAt).getTime();
    if (sinceMs < STUCK_CALL_THRESHOLD_MS) continue;
    if (!canTransition("CALL_IN_PROGRESS", "CALL_NO_ANSWER")) continue;

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
    await args.repository.saveCandidate({
      ...candidate,
      currentState: "CALL_NO_ANSWER",
      notes: [...candidate.notes, note],
      updatedAt: now
    });
    await args.repository.addTransition(transition);

    const recovery: StuckCallRecovery = {
      candidateId: candidate.id,
      instagramUsername: candidate.instagramUsername,
      minutesStuck
    };
    recovered.push(recovery);
    try {
      await args.notify?.(recovery);
    } catch {
      // El aviso jamás bloquea la recuperación (best-effort).
    }
    console.log("[call-watchdog] llamada atascada recuperada", { candidateId: candidate.id, minutesStuck });
  }

  return recovered;
}
