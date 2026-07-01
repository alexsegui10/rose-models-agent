/**
 * Análisis DETERMINISTA del transcript de una llamada terminada (lo manda el webhook de fin). Reproduce
 * los turnos de la candidata con el MISMO oído+director de la llamada en vivo (replay estable) para
 * reconstruir los hechos que el estado "completed" de la plataforma se traga:
 *  - ¿Declaró ser MENOR durante la llamada? (invariante 2: la candidata debe quedar CERRADA, no
 *    "completada → enviar contrato").
 *  - ¿La llamada acabó en HANDOFF (pidió persona / agresión / rechazó el suelo del reparto)? (debe ir a
 *    revisión humana, no a contrato).
 *  - ¿A qué % quedó la negociación? (para la ficha del CRM).
 *
 * Es señal DESCRIPTIVA para que el CÓDIGO decida el estado (invariante 1): nada de LLM aquí.
 */

import { decideCallDirective, initialCallDirectorState, type CallDirectorState, type CallHandoffReason } from "./callDirector";
import { callRevenueShareOfferForStep } from "./callNegotiation";
import { classifyCallSignal } from "./callSignalClassifier";

export interface CallTranscriptFacts {
  /** Declaró ser menor de edad en algún turno (o el cierre reconstruido es el de minoría). */
  underage: boolean;
  /** La llamada terminó transferida a Alex (pidió persona, agresión, rechazó el suelo, audio roto). */
  handedOff: boolean;
  handoffReason?: CallHandoffReason;
  /** % para la modelo al terminar, si el dinero llegó a presentarse (30 si no se negoció a la baja). */
  negotiatedModelShare?: number;
}

export function analyzeCallTranscript(
  transcript: ReadonlyArray<{ role: string; content: string }> | undefined
): CallTranscriptFacts {
  const utterances = (transcript ?? [])
    .filter((turn) => {
      const role = (turn.role ?? "").trim().toLowerCase();
      return role === "user" || role === "candidate" || role === "human";
    })
    .map((turn) => turn.content ?? "");

  // Mismo replay que el cerebro en vivo (callTurnResponder): la apertura se da por hecha (aquí solo
  // importan las señales de la candidata, no el orden del guion).
  let state: CallDirectorState = { ...initialCallDirectorState(), disclosureGiven: true };
  let underage = false;
  for (const utterance of utterances) {
    if (utterance.trim().length === 0) continue;
    const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
    const signal = classifyCallSignal({ utterance, moneyContext });
    if (signal === "underage") underage = true;
    state = decideCallDirective({ state, signal }).nextState;
  }

  const moneyDiscussed = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
  return {
    underage: underage || state.closeDirective === "CLOSE_UNDERAGE",
    handedOff: state.handedOff,
    handoffReason: state.handoffReason,
    negotiatedModelShare: moneyDiscussed ? callRevenueShareOfferForStep(state.revenueShareStep).modelShare : undefined
  };
}
