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

  it("cubre el ciclo de la llamada (bot de voz) desde CALL_SCHEDULED", () => {
    // La llamada arranca, termina, no contesta o se transfiere a Alex.
    expect(canTransition("CALL_SCHEDULED", "CALL_IN_PROGRESS")).toBe(true);
    expect(canTransition("CALL_SCHEDULED", "CALL_NO_ANSWER")).toBe(true);
    // La llamada puede completarse directamente desde agendada (si no hubo evento de "en curso").
    expect(canTransition("CALL_SCHEDULED", "CALL_COMPLETED")).toBe(true);
    expect(canTransition("CALL_IN_PROGRESS", "CALL_COMPLETED")).toBe(true);
    // Handoff a Alex en vivo desde la llamada (invariante 4).
    expect(canTransition("CALL_IN_PROGRESS", "HUMAN_INTERVENTION_REQUIRED")).toBe(true);
    // Tras la llamada o un no-contesta se puede reagendar.
    expect(canTransition("CALL_COMPLETED", "READY_TO_SCHEDULE")).toBe(true);
    expect(canTransition("CALL_NO_ANSWER", "CALL_SCHEDULED")).toBe(true);
    // Re-enganche tras 3 llamadas sin respuesta: se reabre el agendado por IG (volver a pedir dia/hora),
    // que semanticamente es recoger los detalles de la llamada otra vez.
    expect(canTransition("CALL_NO_ANSWER", "COLLECTING_CALL_DETAILS")).toBe(true);
    // Rechazo/cierre humano siguen disponibles en la fase de llamada.
    expect(canTransition("CALL_IN_PROGRESS", "REJECTED")).toBe(true);
    expect(canTransition("CALL_COMPLETED", "CLOSED")).toBe(true);
    // No hay atajos imposibles: no se vuelve a cualificar desde una llamada completada.
    expect(canTransition("CALL_COMPLETED", "QUALIFYING")).toBe(false);
  });
});
