import { describe, expect, it } from "vitest";
import { canTransition } from "@/domain/stateMachine";

describe("state machine", () => {
  it("covers profile review, approved flow and human intervention exits", () => {
    expect(canTransition("WAITING_PROFILE_ACCESS", "PROFILE_READY_FOR_REVIEW")).toBe(true);
    expect(canTransition("PROFILE_READY_FOR_REVIEW", "QUALIFYING")).toBe(true);
    // Alex puede rechazar directamente desde la revision de perfil ("no encaja").
    expect(canTransition("PROFILE_READY_FOR_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("APPROVED", "COLLECTING_CALL_DETAILS")).toBe(true);
    expect(canTransition("APPROVED", "READY_TO_SCHEDULE")).toBe(true);
    expect(canTransition("COLLECTING_CALL_DETAILS", "CALL_SCHEDULED")).toBe(true);
    expect(canTransition("HUMAN_INTERVENTION_REQUIRED", "WAITING_PROFILE_ACCESS")).toBe(true);
    expect(canTransition("HUMAN_INTERVENTION_REQUIRED", "APPROVED")).toBe(true);
    expect(canTransition("CLOSED", "QUALIFYING")).toBe(false);
  });

  it("permite rechazo humano (REJECTED) desde cualquier estado activo, pero no desde CLOSED", () => {
    // Alex puede descartar a una candidata en cualquier punto del funnel desde el CRM.
    for (const state of [
      "NEW_LEAD",
      "WAITING_PROFILE_ACCESS",
      "PROFILE_READY_FOR_REVIEW",
      "QUALIFYING",
      "WAITING_HUMAN_REVIEW",
      "APPROVED",
      "COLLECTING_CALL_DETAILS",
      "READY_TO_SCHEDULE",
      "CALL_SCHEDULED",
      "HUMAN_INTERVENTION_REQUIRED"
    ] as const) {
      expect(canTransition(state, "REJECTED")).toBe(true);
    }
    // CLOSED es terminal: no se sale ni siquiera a REJECTED.
    expect(canTransition("CLOSED", "REJECTED")).toBe(false);
  });
});
