import type { Candidate, CandidateState, StateTransition } from "./candidate";

// REJECTED es alcanzable desde cualquier estado ACTIVO: Alex puede descartar a una candidata en
// cualquier momento desde el CRM (decision humana terminal, invariante 4). CLOSED sigue siendo el
// unico estado del que no se sale.
export const allowedTransitions: Record<CandidateState, CandidateState[]> = {
  NEW_LEAD: [
    "WAITING_PROFILE_ACCESS",
    "PROFILE_READY_FOR_REVIEW",
    "QUALIFYING",
    "REJECTED",
    "HUMAN_INTERVENTION_REQUIRED",
    "CLOSED"
  ],
  WAITING_PROFILE_ACCESS: ["PROFILE_READY_FOR_REVIEW", "QUALIFYING", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  PROFILE_READY_FOR_REVIEW: ["QUALIFYING", "WAITING_HUMAN_REVIEW", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  QUALIFYING: ["PROFILE_READY_FOR_REVIEW", "WAITING_HUMAN_REVIEW", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  WAITING_HUMAN_REVIEW: ["APPROVED", "REJECTED", "QUALIFYING", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  APPROVED: ["COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  REJECTED: ["CLOSED", "HUMAN_INTERVENTION_REQUIRED"],
  COLLECTING_CALL_DETAILS: ["READY_TO_SCHEDULE", "CALL_SCHEDULED", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  READY_TO_SCHEDULE: ["CALL_SCHEDULED", "COLLECTING_CALL_DETAILS", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  CALL_SCHEDULED: [
    "CALL_IN_PROGRESS",
    // La llamada puede completarse directamente desde agendada si no llega evento de "en curso".
    "CALL_COMPLETED",
    "CALL_NO_ANSWER",
    "COLLECTING_CALL_DETAILS",
    "READY_TO_SCHEDULE",
    "REJECTED",
    "HUMAN_INTERVENTION_REQUIRED",
    "CLOSED"
  ],
  // Llamada en curso (bot de voz): termina, no contesta, o se transfiere a Alex en vivo.
  CALL_IN_PROGRESS: ["CALL_COMPLETED", "CALL_NO_ANSWER", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  // Llamada hecha: el bot explico y dejo el siguiente paso; Alex lo retoma (o se reagenda/cierra).
  CALL_COMPLETED: ["READY_TO_SCHEDULE", "CALL_SCHEDULED", "REJECTED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  // No contesto: se reagenda/reintenta o lo retoma Alex. COLLECTING_CALL_DETAILS habilita el
  // re-enganche tras 3 llamadas sin respuesta (el bot reabre el agendado pidiendo dia/hora por IG).
  CALL_NO_ANSWER: [
    "CALL_SCHEDULED",
    "READY_TO_SCHEDULE",
    "COLLECTING_CALL_DETAILS",
    "REJECTED",
    "HUMAN_INTERVENTION_REQUIRED",
    "CLOSED"
  ],
  HUMAN_INTERVENTION_REQUIRED: [
    "WAITING_PROFILE_ACCESS",
    "PROFILE_READY_FOR_REVIEW",
    "QUALIFYING",
    "WAITING_HUMAN_REVIEW",
    "APPROVED",
    "REJECTED",
    "COLLECTING_CALL_DETAILS",
    "READY_TO_SCHEDULE",
    "CALL_SCHEDULED",
    "CALL_COMPLETED",
    "CLOSED"
  ],
  CLOSED: []
};

export function canTransition(fromState: CandidateState, toState: CandidateState): boolean {
  return allowedTransitions[fromState].includes(toState);
}

export function createTransition(input: {
  candidate: Candidate;
  toState: CandidateState;
  trigger: string;
  reason: string;
}): StateTransition {
  if (input.candidate.currentState === input.toState) {
    throw new Error(`Candidate is already in state ${input.toState}`);
  }

  if (!canTransition(input.candidate.currentState, input.toState)) {
    throw new Error(`Invalid transition from ${input.candidate.currentState} to ${input.toState}`);
  }

  return {
    id: crypto.randomUUID(),
    candidateId: input.candidate.id,
    fromState: input.candidate.currentState,
    toState: input.toState,
    trigger: input.trigger,
    reason: input.reason,
    createdAt: new Date()
  };
}
