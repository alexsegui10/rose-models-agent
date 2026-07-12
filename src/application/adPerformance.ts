import type { Candidate } from "@/domain/candidate";

/**
 * Rendimiento por ANUNCIO (presentación pura, sin I/O): agrupa las candidatas por el anuncio del que vinieron
 * (adId/adTitle, que ya se persisten desde la pieza de atribución del 11-jul) y calcula el embudo de CALIDAD
 * de cada creatividad. El objetivo de negocio no es qué anuncio trae MÁS gente, sino cuál trae candidatas que
 * llegan a APTA y a LLAMADA. Las que no vienen de un anuncio caen en el bucket "Orgánico".
 *
 * Mismo patrón que crmView.ts: función pura testeable; la UI (pestaña "Anuncios") solo pinta el resultado.
 */

export interface AdPerformanceRow {
  /** adId real, o "__organic__" para el bucket de las que no vienen de anuncio. */
  adId: string;
  /** Etiqueta legible: título del anuncio, o el id, o "Orgánico". */
  label: string;
  /** true solo para el bucket de las orgánicas (sin anuncio). */
  isOrganic: boolean;
  /** Total de candidatas atribuidas a este anuncio. */
  leads: number;
  /** Respondieron al menos una vez (salieron de NEW_LEAD). */
  responded: number;
  /** Aptas: Alex las aprobó (humanFitDecision APPROVED). La métrica reina de calidad. */
  aptas: number;
  /** Llegaron a hacer la llamada y se completó. */
  callsCompleted: number;
  /** Rechazadas o cerradas (menor, no encaja, no interesada...). */
  discarded: number;
  /** % medio de reparto negociado entre las que tienen dato (de la llamada). null si ninguna. */
  avgNegotiatedShare: number | null;
  /** aptas / leads (0..1). Calidad del anuncio. */
  aptaRate: number;
  /** callsCompleted / aptas (0..1). Cuántas aptas llegan de verdad a la llamada. */
  callRate: number;
}

const ORGANIC_ID = "__organic__";

function respondedOf(candidate: Candidate): boolean {
  return candidate.currentState !== "NEW_LEAD";
}

function callCompletedOf(candidate: Candidate): boolean {
  return candidate.lastCall?.result === "COMPLETED" || candidate.currentState === "CALL_COMPLETED";
}

function discardedOf(candidate: Candidate): boolean {
  return (
    candidate.humanFitDecision === "REJECTED" || candidate.currentState === "REJECTED" || candidate.currentState === "CLOSED"
  );
}

function negotiatedShareOf(candidate: Candidate): number | undefined {
  // El % negociado vive en el registro de la llamada (CallRecord), no en la ficha.
  return candidate.lastCall?.negotiatedModelShare;
}

function rate(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

/**
 * Agrupa y calcula el embudo por anuncio. Ordena por leads descendente; el bucket "Orgánico" siempre al final
 * (aunque tenga más volumen) para que las creatividades queden arriba. Devuelve [] si no hay candidatas.
 */
export function computeAdPerformance(candidates: readonly Candidate[]): AdPerformanceRow[] {
  const buckets = new Map<string, { label: string; isOrganic: boolean; list: Candidate[] }>();

  for (const candidate of candidates) {
    const adId = candidate.adId?.trim();
    const key = adId || ORGANIC_ID;
    const isOrganic = !adId;
    const label = isOrganic ? "Orgánico" : candidate.adTitle?.trim() || adId!;
    const existing = buckets.get(key);
    if (existing) {
      existing.list.push(candidate);
      // El título más reciente/no vacío gana como etiqueta (no dejar el id si alguna trae título).
      if (!isOrganic && candidate.adTitle?.trim()) existing.label = candidate.adTitle.trim();
    } else {
      buckets.set(key, { label, isOrganic, list: [candidate] });
    }
  }

  const rows: AdPerformanceRow[] = [];
  for (const [adId, bucket] of buckets) {
    const leads = bucket.list.length;
    const responded = bucket.list.filter(respondedOf).length;
    const aptas = bucket.list.filter((c) => c.humanFitDecision === "APPROVED").length;
    const callsCompleted = bucket.list.filter(callCompletedOf).length;
    const discarded = bucket.list.filter(discardedOf).length;
    const shares = bucket.list.map(negotiatedShareOf).filter((s): s is number => typeof s === "number");
    const avgNegotiatedShare = shares.length > 0 ? Math.round(shares.reduce((a, b) => a + b, 0) / shares.length) : null;
    rows.push({
      adId,
      label: bucket.label,
      isOrganic: bucket.isOrganic,
      leads,
      responded,
      aptas,
      callsCompleted,
      discarded,
      avgNegotiatedShare,
      aptaRate: rate(aptas, leads),
      callRate: rate(callsCompleted, aptas)
    });
  }

  // Orden: orgánico al final; el resto por leads desc, desempate por aptas desc y luego por etiqueta.
  return rows.sort((a, b) => {
    if (a.isOrganic !== b.isOrganic) return a.isOrganic ? 1 : -1;
    if (b.leads !== a.leads) return b.leads - a.leads;
    if (b.aptas !== a.aptas) return b.aptas - a.aptas;
    return a.label.localeCompare(b.label);
  });
}

/** Total agregado (para la fila de totales de la tabla). */
export interface AdPerformanceTotals {
  leads: number;
  responded: number;
  aptas: number;
  callsCompleted: number;
  discarded: number;
}

export function totalsOf(rows: readonly AdPerformanceRow[]): AdPerformanceTotals {
  return rows.reduce<AdPerformanceTotals>(
    (acc, r) => ({
      leads: acc.leads + r.leads,
      responded: acc.responded + r.responded,
      aptas: acc.aptas + r.aptas,
      callsCompleted: acc.callsCompleted + r.callsCompleted,
      discarded: acc.discarded + r.discarded
    }),
    { leads: 0, responded: 0, aptas: 0, callsCompleted: 0, discarded: 0 }
  );
}
