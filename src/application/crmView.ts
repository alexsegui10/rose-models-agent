import type { Candidate, CandidateState } from "@/domain/candidate";

/**
 * Capa de presentacion PURA del CRM (sin I/O): etiqueta, columna del Kanban y color por estado.
 * Los `Record<CandidateState, ...>` obligan a mapear los 15 estados reales: si se anade un estado
 * nuevo al dominio y no se actualiza aqui, falla el typecheck. Asi ninguna candidata "desaparece"
 * del tablero por caer en un estado sin columna (bug real que existia con el filtrado por arrays).
 */

const STATE_LABELS: Record<CandidateState, string> = {
  NEW_LEAD: "Nueva",
  WAITING_PROFILE_ACCESS: "Esperando solicitud",
  PROFILE_READY_FOR_REVIEW: "Revisar perfil",
  QUALIFYING: "Cualificando",
  WAITING_HUMAN_REVIEW: "Tu decision",
  HUMAN_INTERVENTION_REQUIRED: "Intervencion",
  APPROVED: "Aprobada",
  COLLECTING_CALL_DETAILS: "Agendando",
  READY_TO_SCHEDULE: "Lista para llamada",
  CALL_SCHEDULED: "Llamada agendada",
  CALL_IN_PROGRESS: "Llamando...",
  CALL_COMPLETED: "Llamada hecha",
  CALL_NO_ANSWER: "No contesto",
  REJECTED: "Rechazada",
  CLOSED: "Cerrada"
};

export function stateLabel(state: CandidateState): string {
  return STATE_LABELS[state];
}

export type CrmColumnId = "nuevas" | "cualificando" | "decision" | "agenda" | "llamadas" | "cerradas";

const STATE_COLUMN: Record<CandidateState, CrmColumnId> = {
  NEW_LEAD: "nuevas",
  WAITING_PROFILE_ACCESS: "nuevas",
  QUALIFYING: "cualificando",
  PROFILE_READY_FOR_REVIEW: "decision",
  WAITING_HUMAN_REVIEW: "decision",
  HUMAN_INTERVENTION_REQUIRED: "decision",
  APPROVED: "agenda",
  COLLECTING_CALL_DETAILS: "agenda",
  READY_TO_SCHEDULE: "agenda",
  CALL_SCHEDULED: "agenda",
  CALL_IN_PROGRESS: "llamadas",
  CALL_COMPLETED: "llamadas",
  CALL_NO_ANSWER: "llamadas",
  REJECTED: "cerradas",
  CLOSED: "cerradas"
};

export function crmColumnOf(state: CandidateState): CrmColumnId {
  return STATE_COLUMN[state];
}

export interface CrmColumn {
  id: CrmColumnId;
  title: string;
  tone: string;
}

// Columnas del Kanban en orden. El `tone` mapea a las clases CSS (.crm-card.tone-*, etc.).
export const CRM_COLUMNS: CrmColumn[] = [
  { id: "nuevas", title: "Nuevas", tone: "new" },
  { id: "cualificando", title: "Cualificando", tone: "qualify" },
  { id: "decision", title: "⚠ Tu decision", tone: "attention" },
  { id: "agenda", title: "Agenda", tone: "schedule" },
  { id: "llamadas", title: "Llamadas", tone: "call" },
  { id: "cerradas", title: "Cerradas", tone: "closed" }
];

// Estados que requieren una decision humana explicita (invariante 4): se resaltan en el tablero.
export function needsHumanDecision(candidate: Candidate): boolean {
  return (
    candidate.currentState === "PROFILE_READY_FOR_REVIEW" ||
    candidate.currentState === "WAITING_HUMAN_REVIEW" ||
    candidate.currentState === "HUMAN_INTERVENTION_REQUIRED"
  );
}
