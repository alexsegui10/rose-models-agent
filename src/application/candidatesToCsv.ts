import type { Candidate } from "@/domain/candidate";

/**
 * Exporta las candidatas a CSV (presentación pura, sin I/O). Objetivo de negocio: CONTINGENCIA — el usuario de
 * Instagram es hoy la única clave de contacto de todas las candidatas; si Meta suspende la cuenta, este export
 * (con teléfono + estado + móvil) es la copia con la que Alex puede seguir. También sirve para trabajar los
 * datos fuera del CRM. La UI genera el archivo en el navegador desde este string.
 *
 * CSV robusto: separador coma, cada campo entre comillas dobles con las comillas internas escapadas ("" ),
 * de modo que comas, comillas y saltos de línea en nombres/ciudades no rompan las columnas. Cabecera fija.
 */

const HEADERS = [
  "Usuario",
  "Nombre",
  "Edad",
  "Ciudad",
  "Telefono",
  "Movil",
  "Estado",
  "Decision",
  "Anuncio",
  "Actualizada"
] as const;

/** Escapa un valor para CSV: siempre entre comillas, comillas internas duplicadas. null/undefined -> "". */
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function isoOrEmpty(value: Date | string | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function rowOf(candidate: Candidate): string {
  return [
    csvCell(candidate.instagramUsername),
    csvCell(candidate.firstName),
    csvCell(candidate.age),
    csvCell(candidate.city),
    csvCell(candidate.phone),
    csvCell(candidate.deviceModel),
    csvCell(candidate.currentState),
    csvCell(candidate.humanFitDecision),
    csvCell(candidate.adTitle ?? candidate.adId),
    csvCell(isoOrEmpty(candidate.updatedAt))
  ].join(",");
}

/** Devuelve el CSV completo (cabecera + una fila por candidata). Solo cabecera si la lista está vacía. */
export function candidatesToCsv(candidates: readonly Candidate[]): string {
  const header = HEADERS.map(csvCell).join(",");
  const rows = candidates.map(rowOf);
  return [header, ...rows].join("\r\n");
}

/** Nombre de archivo sugerido con la fecha (la pasa la UI para no usar new Date() aquí). */
export function csvFileName(isoDate: string): string {
  const day = isoDate.slice(0, 10) || "export";
  return `rose-models-candidatas-${day}.csv`;
}
