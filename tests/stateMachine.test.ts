import { describe, expect, it } from "vitest";
import { canTransition } from "@/domain/stateMachine";

describe("state machine", () => {
  it("covers profile review, approved flow and human intervention exits", () => {
    expect(canTransition("WAITING_PROFILE_ACCESS", "PROFILE_READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("PROFILE_READY_FOR_REVIEW", "QUALIFYING")).toBe(true);
    expect(canTransition("APPROVED", "COLLECTING_CALL_DETAILS")).toBe(true);
    expect(canTransition("APPROVED", "READY_TO_SCHEDULE")).toBe(true);
    expect(canTransition("COLLECTING_CALL_DETAILS", "CALL_SCHEDULED")).toBe(true);
    expect(canTransition("HUMAN_INTERVENTION_REQUIRED", "WAITING_PROFILE_ACCESS")).toBe(true);
    expect(canTransition("HUMAN_INTERVENTION_REQUIRED", "APPROVED")).toBe(true);
    expect(canTransition("CLOSED", "QUALIFYING")).toBe(false);
  });
});

