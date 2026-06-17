/**
 * Contexto de la candidata para la LLAMADA: lo que ya sabemos de ella por el DM de Instagram, para que el
 * bot hable SABIENDO con quién habla (usa su nombre, referencia lo hablado, aborda sus dudas y no repite
 * lo ya tratado). Se construye desde la `Candidate` en el disparo de la llamada y se inyecta al cerebro.
 *
 * Es un RESUMEN seguro (sin teléfono ni datos sensibles innecesarios): el bot no necesita el móvil para
 * hablar. La redacción por LLM (cuando se conecte) lo usará para personalizar; el camino determinista usa
 * al menos el nombre.
 */

import type { Candidate } from "@/domain/candidate";

export interface CallContext {
  /** Nombre de pila para dirigirse a ella. */
  candidateName?: string;
  age?: number;
  country?: string;
  /** ¿Ya tiene OnlyFans? (afecta a cómo se le habla del arranque). */
  hasOnlyFans?: boolean;
  /** ¿Trabaja con otra agencia? (relevante para exclusividad/tráfico). */
  worksWithAnotherAgency?: boolean;
  /** Franja acordada para la llamada (texto libre). */
  scheduledSlot?: string;
  /** Resumen de lo hablado por Instagram (para no repetir y poder referenciarlo: "como te dije por Insta"). */
  dmSummary?: string;
  /** Dudas/objeciones que planteó en el DM (para abordarlas con tacto en la llamada). */
  concerns: string[];
  /** Nivel de interés detectado en el DM (UNKNOWN/LOW/MEDIUM/HIGH). */
  interestLevel?: string;
}

/**
 * Construye el contexto de llamada desde la `Candidate` (lo que sacamos del DM). Lo usa el disparador de la
 * llamada saliente para pasárselo a la plataforma de voz; el endpoint lo recibe y lo inyecta al cerebro.
 */
export function buildCallContext(candidate: Candidate): CallContext {
  const summary = candidate.conversationSummary?.trim();
  return {
    candidateName: candidate.firstName?.trim() || candidate.displayName?.trim() || undefined,
    age: candidate.age,
    country: candidate.country?.trim() || undefined,
    hasOnlyFans: candidate.hasOnlyFans,
    worksWithAnotherAgency: candidate.worksWithAnotherAgency,
    scheduledSlot: candidate.scheduledCallSlot?.trim() || undefined,
    dmSummary: summary && summary.length > 0 ? summary : undefined,
    concerns: dedupe(candidate.objections ?? []),
    interestLevel: candidate.interestLevel
  };
}

/**
 * Resumen breve del contexto en una línea (para trazas / para inyectar como instrucción al LLM de voz).
 * No incluye datos sensibles innecesarios.
 */
export function summarizeCallContext(context: CallContext): string {
  const parts: string[] = [];
  if (context.candidateName) parts.push(`Nombre: ${context.candidateName}`);
  if (typeof context.age === "number") parts.push(`Edad: ${context.age}`);
  if (context.country) parts.push(`País: ${context.country}`);
  if (typeof context.hasOnlyFans === "boolean") parts.push(`OnlyFans: ${context.hasOnlyFans ? "sí" : "no/aún no"}`);
  if (context.worksWithAnotherAgency) parts.push("Trabaja con otra agencia");
  if (context.concerns.length > 0) parts.push(`Dudas previas: ${context.concerns.join(", ")}`);
  if (context.dmSummary) parts.push(`Resumen del chat: ${context.dmSummary}`);
  return parts.join(" · ");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}
