import { describe, expect, it } from "vitest";
import { CandidateStateSchema } from "@/domain/candidate";
import {
  computeFitScore,
  CRM_COLUMNS,
  crmColumnOf,
  isTopPick,
  needsHumanDecision,
  ringColorVar,
  stateLabel
} from "@/application/crmView";
import type { Candidate } from "@/domain/candidate";

describe("crmView", () => {
  it("cada uno de los estados reales cae en una columna existente (ninguna candidata desaparece del tablero)", () => {
    const columnIds = new Set(CRM_COLUMNS.map((column) => column.id));
    for (const state of CandidateStateSchema.options) {
      const column = crmColumnOf(state);
      expect(columnIds.has(column), `${state} -> columna inexistente "${column}"`).toBe(true);
    }
  });

  it("los estados de llamada van a la columna 'agenda' (maqueta de 4 columnas, sin columna 'llamadas')", () => {
    expect(crmColumnOf("CALL_IN_PROGRESS")).toBe("agenda");
    expect(crmColumnOf("CALL_COMPLETED")).toBe("agenda");
    expect(crmColumnOf("CALL_NO_ANSWER")).toBe("agenda");
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

  it("las que esperan decision caen en la columna 'decision' (maqueta de 4 columnas)", () => {
    expect(crmColumnOf("PROFILE_READY_FOR_REVIEW")).toBe("decision");
    expect(crmColumnOf("WAITING_HUMAN_REVIEW")).toBe("decision");
    expect(crmColumnOf("HUMAN_INTERVENTION_REQUIRED")).toBe("decision");
    expect(CRM_COLUMNS.map((column) => column.id)).toEqual(["cualificando", "decision", "agenda", "cerradas"]);
  });

  it("la nota FIT es honesta y determinista: 0 sin datos, sube con senales reales, top pick con nota alta", () => {
    expect(computeFitScore({ currentState: "QUALIFYING" } as Candidate, null)).toBe(0);
    const fuerte = computeFitScore(
      { currentState: "QUALIFYING", age: 34, hasOnlyFans: true, phone: "+54911", deviceEligibility: "APPROVED" } as Candidate,
      60000
    );
    expect(fuerte).toBeGreaterThanOrEqual(80);
    expect(isTopPick(fuerte)).toBe(true);
    expect(isTopPick(40)).toBe(false);
  });

  it("ringColorVar es ambar (--warn) para las que esperan decision, y el color de su columna si no", () => {
    expect(ringColorVar({ currentState: "WAITING_HUMAN_REVIEW" } as Candidate)).toBe("--warn");
    expect(ringColorVar({ currentState: "PROFILE_READY_FOR_REVIEW" } as Candidate)).toBe("--warn");
    expect(ringColorVar({ currentState: "CALL_IN_PROGRESS" } as Candidate)).toBe("--info");
    expect(ringColorVar({ currentState: "QUALIFYING" } as Candidate)).toBe("--accent");
  });
});
