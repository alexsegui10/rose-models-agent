/**
 * Utilidades de AGENDADO de la llamada de voz (decisión de Alex 19-jun):
 * - La llamada la hace el bot de voz (horario infinito); la candidata elige la hora.
 * - La candidata da SIEMPRE la hora en horario de Argentina (UTC-3, sin horario de verano); el bot la
 *   convierte automáticamente a horario de España (Europe/Madrid, CON horario de verano).
 * - Cada llamada ocupa ~30 min; no puede haber dos llamadas que se solapen en esa ventana.
 * Puro y determinista: sin I/O. El parseo del texto libre y la persistencia se hacen fuera.
 */

export const CALL_DURATION_MINUTES = 30;

// Argentina (America/Argentina/Buenos_Aires) es UTC-3 fijo todo el año (no aplica horario de verano).
const ARGENTINA_UTC_OFFSET_HOURS = -3;

/**
 * Convierte una hora de pared de Argentina a hora de pared de España, respetando el horario de verano
 * español del día indicado. `onDate` es el día de la llamada (para saber si en España es verano o
 * invierno); en verano la diferencia es de 5h (18:00 AR → 23:00 ES) y en invierno de 4h.
 */
export function argentinaToSpainClock(
  argentinaHour: number,
  argentinaMinute: number,
  onDate: Date
): { hour: number; minute: number; label: string } {
  // Instante UTC de esa hora de pared argentina: hora AR menos su offset (-3) => AR + 3h.
  const utcMs = Date.UTC(
    onDate.getUTCFullYear(),
    onDate.getUTCMonth(),
    onDate.getUTCDate(),
    argentinaHour - ARGENTINA_UTC_OFFSET_HOURS,
    argentinaMinute
  );
  const formatter = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(new Date(utcMs));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const label = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return { hour, minute, label };
}

/**
 * ¿El hueco propuesto (instante de inicio en ms UTC) se solapa con alguno ya reservado? Cada llamada dura
 * CALL_DURATION_MINUTES, así que hay choque si los inicios distan menos de esa ventana. Así el bot nunca
 * agenda dos llamadas a la misma hora (decisión de Alex).
 */
export function conflictsWithBooked(proposedStartMs: number, bookedStartsMs: readonly number[]): boolean {
  const windowMs = CALL_DURATION_MINUTES * 60_000;
  return bookedStartsMs.some((bookedMs) => Math.abs(bookedMs - proposedStartMs) < windowMs);
}
