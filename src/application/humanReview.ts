import type { Candidate, CandidateState, StateTransition } from "@/domain/candidate";
import { createTransition } from "@/domain/stateMachine";

export const HumanReviewDecision = {
  APPROVE: "APPROVE",
  REJECT: "REJECT",
  REQUEST_MORE_INFO: "REQUEST_MORE_INFO",
  TAKE_OVER: "TAKE_OVER"
} as const;

export type HumanReviewDecision = (typeof HumanReviewDecision)[keyof typeof HumanReviewDecision];

export function applyHumanReviewDecision(input: {
  candidate: Candidate;
  decision: HumanReviewDecision;
  note?: string;
}): { candidate: Candidate; transition: StateTransition } {
  const toState = humanDecisionToState(input.decision);
  const transition = createTransition({
    candidate: input.candidate,
    toState,
    trigger: `HUMAN_REVIEW_${input.decision}`,
    reason: input.note ?? "Decision de revision humana."
  });

  const humanReviewStatus =
    input.decision === "APPROVE"
      ? "APPROVED"
      : input.decision === "REJECT"
        ? "REJECTED"
        : input.decision === "REQUEST_MORE_INFO"
          ? "MORE_INFO_REQUESTED"
          : "TAKEN_OVER";

  return {
    transition,
    candidate: {
      ...input.candidate,
      currentState: toState,
      humanReviewStatus,
      humanProfileReviewStatus: input.decision === "APPROVE" ? "POTENTIAL_FIT" : input.decision === "REJECT" ? "NOT_A_FIT" : input.candidate.humanProfileReviewStatus,
      humanFitDecision: input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "PENDING",
      notes: input.note ? [...input.candidate.notes, input.note] : input.candidate.notes,
      updatedAt: new Date()
    }
  };
}

function humanDecisionToState(decision: HumanReviewDecision): CandidateState {
  switch (decision) {
    case "APPROVE":
      return "APPROVED";
    case "REJECT":
      return "REJECTED";
    case "REQUEST_MORE_INFO":
      return "QUALIFYING";
    case "TAKE_OVER":
      return "HUMAN_INTERVENTION_REQUIRED";
  }
}
