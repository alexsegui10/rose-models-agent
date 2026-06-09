import type { Candidate, CandidateState, StateTransition } from "./candidate";

export const allowedTransitions: Record<CandidateState, CandidateState[]> = {
  NEW_LEAD: ["WAITING_PROFILE_ACCESS", "PROFILE_READY_FOR_REVIEW", "QUALIFYING", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  WAITING_PROFILE_ACCESS: ["PROFILE_READY_FOR_REVIEW", "QUALIFYING", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  PROFILE_READY_FOR_REVIEW: ["QUALIFYING", "WAITING_HUMAN_REVIEW", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  QUALIFYING: ["PROFILE_READY_FOR_REVIEW", "WAITING_HUMAN_REVIEW", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  WAITING_HUMAN_REVIEW: ["APPROVED", "REJECTED", "QUALIFYING", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  APPROVED: ["COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  REJECTED: ["CLOSED", "HUMAN_INTERVENTION_REQUIRED"],
  COLLECTING_CALL_DETAILS: ["READY_TO_SCHEDULE", "CALL_SCHEDULED", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  READY_TO_SCHEDULE: ["CALL_SCHEDULED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
  CALL_SCHEDULED: ["COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "HUMAN_INTERVENTION_REQUIRED", "CLOSED"],
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
