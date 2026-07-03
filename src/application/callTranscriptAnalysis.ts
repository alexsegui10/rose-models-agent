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

import type { CallAgendaStageId } from "./callAgenda";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState, type CallHandoffReason } from "./callDirector";
import { callRevenueShareOfferForStep } from "./callNegotiation";
import { classifyCallSignal } from "./callSignalClassifier";

export interface CallTranscriptFacts {
  /** Declaró ser menor de edad en algún turno (o el cierre reconstruido es el de minoría). */
  underage: boolean;
  /** La llamada terminó transferida a Alex (pidió persona, agresión, rechazó el suelo, audio roto). */
  handedOff: boolean;
  handoffReason?: CallHandoffReason;
  /** La pillamos en mal momento nada más descolgar: el cierre fue "te escribo por IG y lo movemos". */
  rescheduleRequested?: boolean;
  /** % para la modelo al terminar, si el dinero llegó a presentarse (30 si no se negoció a la baja). */
  negotiatedModelShare?: number;
  /** Etapas del guion que llegaron a cubrirse (sin el cierre) — para el resumen del CRM. */
  coveredStages: CallAgendaStageId[];
  /** El cierre reconstruido fue el normal con contrato ("te paso el contrato y las guías"). */
  closedWithContract: boolean;
  /** Nº de preguntas que quedaron deferidas ("te lo confirmo por WhatsApp") — para el resumen. */
  deferredQuestions: number;
  /** Turnos con habla REAL de la candidata: la EVIDENCIA de que hubo conversación (jul-2026: un status
   *  "failed" de la plataforma en una llamada completa marcaba NO CONTESTA y disparaba re-llamadas). */
  candidateTurns: number;
}

export function analyzeCallTranscript(
  transcript: ReadonlyArray<{ role: string; content: string }> | undefined
): CallTranscriptFacts {
  // Turnos de ella + lo último dicho por el BOT antes de cada uno (para las señales de aclaración:
  // "¿qué significa X?" solo lo es si X estaba en la frase previa del bot — mismo criterio que en vivo).
  const utterances: Array<{ text: string; lastBot?: string }> = [];
  let lastBot: string | undefined;
  for (const turn of transcript ?? []) {
    const role = (turn.role ?? "").trim().toLowerCase();
    const content = turn.content ?? "";
    if (role === "user" || role === "candidate" || role === "human") {
      utterances.push({ text: content, lastBot });
    } else if (content.trim().length > 0) {
      lastBot = content;
    }
  }

  // Mismo replay que el cerebro en vivo (callTurnResponder): la apertura se da por hecha (aquí solo
  // importan las señales de la candidata, no el orden del guion).
  let state: CallDirectorState = { ...initialCallDirectorState(), disclosureGiven: true };
  let underage = false;
  let deferredQuestions = 0;
  let candidateTurns = 0;
  for (const utterance of utterances) {
    if (utterance.text.trim().length === 0) continue;
    // Solo el habla REAL cuenta como evidencia de conversación (riesgo del revisor 3-jul): el ASR de la
    // plataforma emite "..." en bucle en llamadas muertas y eso NO puede convertir un fallo en COMPLETED.
    // El turno se sigue clasificando igualmente (el ruido alimenta unclear/handoff como en vivo).
    if (/[a-zá-úñ0-9]{2,}/i.test(utterance.text)) candidateTurns += 1;
    const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
    const signal = classifyCallSignal({ utterance: utterance.text, moneyContext, lastBotUtterance: utterance.lastBot });
    if (signal === "underage") underage = true;
    const decision = decideCallDirective({ state, signal });
    if (decision.directive.type === "DEFER_TO_PARTNER") deferredQuestions += 1;
    state = decision.nextState;
  }

  const moneyDiscussed = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
  return {
    underage: underage || state.closeDirective === "CLOSE_UNDERAGE",
    handedOff: state.handedOff,
    handoffReason: state.handoffReason,
    rescheduleRequested: state.closeDirective === "CLOSE_RESCHEDULE",
    negotiatedModelShare: moneyDiscussed ? callRevenueShareOfferForStep(state.revenueShareStep).modelShare : undefined,
    coveredStages: state.coveredStages.filter((id) => id !== "CLOSE"),
    closedWithContract: state.closeDirective === "CLOSE_WITH_CONTRACT",
    deferredQuestions,
    candidateTurns
  };
}
