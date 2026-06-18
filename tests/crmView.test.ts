import { describe, expect, it } from "vitest";
import { CandidateStateSchema } from "@/domain/candidate";
import { CRM_COLUMNS, crmColumnOf, needsHumanDecision, stateLabel } from "@/application/crmView";
import type { Candidate } from "@/domain/candidate";

describe("crmView", () => {
  it("cada uno de los estados reales cae en una columna existente (ninguna candidata desaparece del tablero)", () => {
    const columnIds = new Set(CRM_COLUMNS.map((column) => column.id));
    for (const state of CandidateStateSchema.options) {
      const column = crmColumnOf(state);
      expect(columnIds.has(column), `${state} -> columna inexistente "${column}"`).toBe(true);
    }
  });

  it("los estados de llamada van a la columna 'llamadas' (regresion del bug: antes desaparecian)", () => {
    expect(crmColumnOf("CALL_IN_PROGRESS")).toBe("llamadas");
    expect(crmColumnOf("CALL_COMPLETED")).toBe("llamadas");
    expect(crmColumnOf("CALL_NO_ANSWER")).toBe("llamadas");
  });

  it("cada estado tiene etiqueta en espanol no vacia", () => {
    for (const state of CandidateStateSchema.options) {
      expect(stateLabel(state).length).toBeGreaterThan(0);
    }
  });

  it("needsHumanDecision es cierto solo para los estados que esperan decision humana", () => {
    const decisionStates = CandidateStateSchema.options.filter((state) =>
      needsHumanDecision({ currentState: state } as Candidate)
    );
    expect(decisionStates.sort()).toEqual(
      ["HUMAN_INTERVENTION_REQUIRED", "PROFILE_READY_FOR_REVIEW", "WAITING_HUMAN_REVIEW"].sort()
    );
  });
});
