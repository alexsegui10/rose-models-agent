import type { Candidate, CandidateState } from "@/domain/candidate";

/**
 * Capa de presentacion PURA del CRM (sin I/O): etiqueta, columna del Kanban, color por estado y
 * color del anillo del avatar. Replica el diseno de la maqueta: 5 columnas; las candidatas que
 * esperan decision humana caen en "cualificando" y se distinguen por el ANILLO AMBAR del avatar.
 * Los `Record<CandidateState, ...>` obligan a mapear los 15 estados reales (si se anade uno y no se
 * mapea aqui, falla el typecheck): asi ninguna candidata desaparece del tablero.
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

// Color (nombre de var CSS) de la pill de estado, segun la tabla PCOL de la maqueta.
const STATE_COLOR_VAR: Record<CandidateState, string> = {
  NEW_LEAD: "--muted",
  WAITING_PROFILE_ACCESS: "--muted",
  QUALIFYING: "--accent",
  PROFILE_READY_FOR_REVIEW: "--warn",
  WAITING_HUMAN_REVIEW: "--warn",
  HUMAN_INTERVENTION_REQUIRED: "--danger",
  APPROVED: "--success",
  COLLECTING_CALL_DETAILS: "--info",
  READY_TO_SCHEDULE: "--info",
  CALL_SCHEDULED: "--info",
  CALL_IN_PROGRESS: "--purple",
  CALL_COMPLETED: "--success",
  CALL_NO_ANSWER: "--danger",
  REJECTED: "--muted",
  CLOSED: "--muted"
};

export function stateColorVar(state: CandidateState): string {
  return STATE_COLOR_VAR[state];
}

export type CrmColumnId = "nuevas" | "cualificando" | "agenda" | "llamadas" | "cerradas";

const STATE_COLUMN: Record<CandidateState, CrmColumnId> = {
  NEW_LEAD: "nuevas",
  WAITING_PROFILE_ACCESS: "nuevas",
  QUALIFYING: "cualificando",
  // Las que esperan decision humana caen en "cualificando" (se marcan con anillo ambar).
  PROFILE_READY_FOR_REVIEW: "cualificando",
  WAITING_HUMAN_REVIEW: "cualificando",
  HUMAN_INTERVENTION_REQUIRED: "cualificando",
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
  /** Nombre de var CSS del color de la fase (barra/punto). */
  colorVar: string;
  emptyIcon: string;
  emptyText: string;
}

// Las 5 columnas del Kanban, en orden, como en la maqueta.
export const CRM_COLUMNS: CrmColumn[] = [
  { id: "nuevas", title: "Nuevas", colorVar: "--faint", emptyIcon: "📭", emptyText: "Sin candidatas nuevas." },
  { id: "cualificando", title: "Cualificando", colorVar: "--accent", emptyIcon: "💬", emptyText: "Nadie cualificando ahora." },
  { id: "agenda", title: "Agenda", colorVar: "--info", emptyIcon: "📅", emptyText: "Sin llamadas por agendar." },
  { id: "llamadas", title: "Llamadas", colorVar: "--purple", emptyIcon: "📞", emptyText: "Sin actividad de llamadas." },
  { id: "cerradas", title: "Cerradas", colorVar: "--faint", emptyIcon: "📁", emptyText: "Sin candidatas cerradas." }
];

// Estados que requieren una decision humana explicita (invariante 4): anillo ambar en el tablero.
export function needsHumanDecision(candidate: Candidate): boolean {
  return (
    candidate.currentState === "PROFILE_READY_FOR_REVIEW" ||
    candidate.currentState === "WAITING_HUMAN_REVIEW" ||
    candidate.currentState === "HUMAN_INTERVENTION_REQUIRED"
  );
}

const COLUMN_RING_VAR: Record<CrmColumnId, string> = {
  nuevas: "--muted",
  cualificando: "--accent",
  agenda: "--info",
  llamadas: "--purple",
  cerradas: "--faint"
};

/**
 * Color (nombre de var CSS) del anillo del avatar en el tablero: AMBAR si espera decision humana
 * (ignora la columna), si no el color de su columna. Replica `ringFor` de la maqueta.
 */
export function ringColorVar(candidate: Candidate): string {
  if (needsHumanDecision(candidate)) return "--warn";
  return COLUMN_RING_VAR[crmColumnOf(candidate.currentState)];
}
