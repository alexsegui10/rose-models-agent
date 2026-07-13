import type { Candidate, CandidateState } from "@/domain/candidate";

/**
 * Capa de presentacion PURA del CRM (sin I/O): etiqueta, columna del Kanban, color por estado, color
 * del anillo del avatar y nota FIT. Replica la maqueta de Alex: 4 columnas (Cualificando, Tu decision,
 * Agenda, Cerradas); las que esperan tu decision tienen su propia columna "decision" (anillo AMBAR).
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

export type CrmColumnId = "cualificando" | "decision" | "agenda" | "cerradas";

const STATE_COLUMN: Record<CandidateState, CrmColumnId> = {
  NEW_LEAD: "cualificando",
  WAITING_PROFILE_ACCESS: "cualificando",
  QUALIFYING: "cualificando",
  // Las que esperan TU decision van a su propia columna "decision" (Tu decision) — la maqueta de Alex.
  PROFILE_READY_FOR_REVIEW: "decision",
  WAITING_HUMAN_REVIEW: "decision",
  HUMAN_INTERVENTION_REQUIRED: "decision",
  APPROVED: "agenda",
  COLLECTING_CALL_DETAILS: "agenda",
  READY_TO_SCHEDULE: "agenda",
  CALL_SCHEDULED: "agenda",
  // La actividad de llamada vive en "agenda" (ya no hay columna "llamadas" en la maqueta de 4).
  CALL_IN_PROGRESS: "agenda",
  CALL_COMPLETED: "agenda",
  CALL_NO_ANSWER: "agenda",
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

// Las 4 columnas del Kanban, en orden, como en la maqueta de Alex.
export const CRM_COLUMNS: CrmColumn[] = [
  { id: "cualificando", title: "Cualificando", colorVar: "--accent", emptyIcon: "💬", emptyText: "Nadie cualificando ahora." },
  { id: "decision", title: "Tu decisión", colorVar: "--warn", emptyIcon: "🎯", emptyText: "Nada pendiente de tu decisión." },
  { id: "agenda", title: "Agenda", colorVar: "--info", emptyIcon: "📅", emptyText: "Sin llamadas por agendar." },
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
  cualificando: "--accent",
  decision: "--warn",
  agenda: "--info",
  cerradas: "--faint"
};

/**
 * Nota FIT (0-99) HONESTA y determinista: NO es un juicio del modelo, es una heuristica transparente
 * sobre 4 senales reales que ya tenemos (Alex aprobo estos factores): edad en rango, seguidores,
 * experiencia en OnlyFans y movil apto. `followerCount` viene del perfil de Instagram (no de
 * Candidate), por eso se pasa aparte. Devuelve 0 si no hay ninguna senal.
 */
export function computeFitScore(candidate: Candidate, followerCount: number | null): number {
  let score = 0;
  // Edad en el rango objetivo (Argentina ~30-50, con margen).
  if (typeof candidate.age === "number") {
    score += candidate.age >= 28 && candidate.age <= 52 ? 25 : 12;
  }
  // Alcance (mas seguidores = mejor lead).
  if (followerCount != null) {
    if (followerCount >= 50000) score += 25;
    else if (followerCount >= 10000) score += 20;
    else if (followerCount >= 3000) score += 14;
    else if (followerCount >= 1000) score += 8;
    else score += 4;
  }
  // Experiencia en OnlyFans.
  if (candidate.hasOnlyFans === true) score += 25;
  else if (candidate.hasOnlyFans === false) score += 8;
  // Movil apto para grabar.
  if (candidate.phone) {
    score += candidate.deviceEligibility === "APPROVED" ? 25 : candidate.deviceEligibility === "PENDING_QUALITY_TEST" ? 15 : 10;
  } else if (candidate.deviceEligibility === "PENDING_QUALITY_TEST") {
    score += 5;
  }
  return Math.min(99, Math.max(0, Math.round(score)));
}

/** "Top pick": nota alta (senal fuerte en varias dimensiones). */
export function isTopPick(score: number): boolean {
  return score >= 80;
}

/**
 * Color (nombre de var CSS) del anillo del avatar en el tablero: AMBAR si espera decision humana
 * (ignora la columna), si no el color de su columna. Replica `ringFor` de la maqueta.
 */
export function ringColorVar(candidate: Candidate): string {
  if (needsHumanDecision(candidate)) return "--warn";
  return COLUMN_RING_VAR[crmColumnOf(candidate.currentState)];
}
