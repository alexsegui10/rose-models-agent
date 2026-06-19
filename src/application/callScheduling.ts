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

// Días de la semana en español (índice 0 = domingo, igual que Date.getUTCDay), sin acentos para casar con
// el texto normalizado de la candidata y para el label ("el lunes a las ...").
const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"] as const;

// Quita acentos y pasa a minúsculas para que el matcher no dependa de la ortografía de la candidata.
function normalizeForParse(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ¿Una palabra de tiempo va NEGADA cerca de un "no"? ("el viernes no...", "ahora no", "manana tampoco").
// Si toda mención de tiempo está negada, no es una propuesta y el parser devuelve null.
const NEGATED_TIME_PATTERN =
  /\bno\b[^.!?]{0,15}\b(ahora|hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|mediodia)\b|\b(ahora|hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|mediodia)\b[^.!?]{0,15}\b(no|tampoco)\b/;

/**
 * Calcula el día (en el CALENDARIO de Argentina) sobre el que cae la propuesta, a partir de `now` (instante
 * UTC) y del texto. Devuelve los componentes de fecha de ese día en Argentina. "hoy/manana/pasado" son
 * relativos al día actual en Argentina; "[proximo] lunes..domingo" salta al PRÓXIMO día de esa semana
 * (estrictamente futuro respecto a hoy en Argentina). Si no hay marcador de día, asume HOY.
 */
function resolveArgentinaDate(message: string, now: Date): { year: number; month: number; day: number } {
  // Día actual en Argentina (UTC-3): el instante UTC menos 3h da la hora de pared argentina.
  const argentinaNowMs = now.getTime() + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60_000;
  const argentinaNow = new Date(argentinaNowMs);
  const baseY = argentinaNow.getUTCFullYear();
  const baseM = argentinaNow.getUTCMonth();
  const baseD = argentinaNow.getUTCDate();
  const todayUtcMidnight = Date.UTC(baseY, baseM, baseD);

  // "de/por la manana" es la FRANJA del dia (8 de la manana), NO el dia "manana" (tomorrow): se elimina
  // antes de detectar el marcador de dia para no agendar tomorrow cuando dicen "a las 8 de la manana".
  const dayMessage = message.replace(/\b(?:de|por) la manana\b/g, " ");
  let offsetDays = 0;
  if (/\bpasado\s+manana\b/.test(dayMessage)) {
    offsetDays = 2;
  } else if (/\bmanana\b/.test(dayMessage)) {
    offsetDays = 1;
  } else {
    const weekdayIndex = WEEKDAY_NAMES.findIndex((name) => new RegExp(`\\b${name}\\b`).test(dayMessage));
    if (weekdayIndex >= 0) {
      const todayWeekday = new Date(todayUtcMidnight).getUTCDay();
      // Próxima ocurrencia ESTRICTAMENTE futura de ese día de la semana (1..7 días adelante).
      offsetDays = (weekdayIndex - todayWeekday + 7) % 7 || 7;
    }
    // "hoy" o sin marcador -> offsetDays = 0.
  }

  const target = new Date(todayUtcMidnight + offsetDays * 24 * 60 * 60_000);
  return { year: target.getUTCFullYear(), month: target.getUTCMonth(), day: target.getUTCDate() };
}

/**
 * Extrae la hora de pared ARGENTINA (hour 0-23, minute) del mensaje, o null si no hay hora clara.
 * Soporta: "las 18", "6pm", "6 de la tarde", "18:30", "10.30am", "a las 10". Las palabras de franja
 * sueltas ("por las tardes", "por la noche") NO cuentan como hora concreta (devuelven null).
 */
function parseArgentinaHour(message: string): { hour: number; minute: number } | null {
  // 1) Hora con minutos explícitos: 18:30, 18.30, 10:30am. El separador puede ser ':' o '.'.
  const withMinutes = message.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm|hs|h|horas)?\b/);
  if (withMinutes) {
    let hour = Number(withMinutes[1]);
    const minute = Number(withMinutes[2]);
    const meridiem = withMinutes[3];
    if (hour > 23 || minute > 59) return null;
    hour = applyMeridiem(hour, meridiem, message);
    return { hour: hour % 24, minute };
  }

  // 2) Hora sin minutos: "las 18", "6pm", "a las 6", "6 de la tarde". Exige un anclaje ("las"/"a las"/
  //    meridiano/franja) para no confundir un número cualquiera (edad, etc.) con una hora.
  const hourMatch = message.match(
    /\b(?:a\s+)?las\s+(\d{1,2})\b|\b(\d{1,2})\s*(am|pm|hs|h|horas)\b|\b(\d{1,2})\s+de\s+la\s+(manana|tarde|noche|madrugada)\b/
  );
  if (hourMatch) {
    const raw = Number(hourMatch[1] ?? hourMatch[2] ?? hourMatch[4]);
    if (Number.isNaN(raw) || raw > 23) return null;
    const meridiem = hourMatch[3];
    const franja = hourMatch[5];
    const hour = applyMeridiem(raw, meridiem, franja ? `de la ${franja}` : message);
    return { hour: hour % 24, minute: 0 };
  }

  return null;
}

// Lleva una hora 1-12 a formato 24h según el meridiano explícito (am/pm) o la franja del día ("tarde",
// "noche", "mediodia"). Si la hora ya es 13-23 o no hay pista, se respeta tal cual.
function applyMeridiem(hour: number, meridiem: string | undefined, context: string): number {
  // "12 de la noche/madrugada" es MEDIANOCHE (00:00), no mediodia; "12 del mediodia/tarde" es 12:00.
  if (hour === 12) {
    if (/\b(de la noche|por la noche|de la madrugada|por la madrugada)\b/.test(context)) return 0;
    if (meridiem === "am") return 0;
    return 12;
  }
  if (meridiem === "pm" && hour < 12) return hour + 12;
  if (meridiem === "am") return hour;
  // Sin meridiano explícito: usar la franja del día si la hay (6 de la tarde -> 18).
  if (hour >= 1 && hour <= 11) {
    if (/\b(de la tarde|de la noche|por la tarde|por la noche)\b/.test(context)) return hour + 12;
    if (/\bmediodia\b/.test(context)) return 12;
  }
  return hour;
}

/**
 * Parser DETERMINISTA de la hora que propone la candidata (siempre en hora ARGENTINA). Resuelve el día
 * relativo + la hora, convierte a hora de España con `argentinaToSpainClock` y devuelve el instante de
 * inicio en ms UTC y un label en español ("el lunes a las 23:00"). Devuelve null si no hay hora clara,
 * si la hora está negada ("el viernes no...") o si es vago ("por las tardes"). NO usa OpenAI: la decisión
 * de agendar la toma el código, nunca el modelo (invariante 1).
 */
export function parseProposedCallTime(message: string, now: Date): { startMsUtc: number; labelEs: string } | null {
  const normalized = normalizeForParse(message);

  // Propuesta negada ("el viernes no puedo", "ahora no, manana tampoco"): no se agenda nada.
  if (NEGATED_TIME_PATTERN.test(normalized)) {
    return null;
  }

  const time = parseArgentinaHour(normalized);
  if (!time) {
    return null;
  }

  const date = resolveArgentinaDate(normalized, now);
  // Instante UTC de esa hora de pared argentina: AR menos su offset (-3) => AR + 3h.
  const startMsUtc = Date.UTC(date.year, date.month, date.day, time.hour - ARGENTINA_UTC_OFFSET_HOURS, time.minute);
  // No agendar en el PASADO: "hoy a las 10" cuando ya son las 11 (sin marcador de dia futuro) es ambiguo;
  // devolvemos null para que el bot vuelva a pedir la hora en vez de agendar una cita ya pasada.
  if (startMsUtc <= now.getTime()) {
    return null;
  }
  const onDate = new Date(Date.UTC(date.year, date.month, date.day));
  const spain = argentinaToSpainClock(time.hour, time.minute, onDate);
  // El label se expresa en hora de España (la que vive Alex/el bot): el día también es el de España en ese
  // instante, que puede cruzar medianoche respecto a Argentina (21:00 AR -> 02:00 ES del día siguiente).
  const weekday = spainWeekday(startMsUtc);
  const labelEs = `el ${weekday} a las ${spain.label}`;
  return { startMsUtc, labelEs };
}

// Día de la semana (en español, sin acentos) en el huso de España para un instante UTC dado.
function spainWeekday(utcMs: number): string {
  const dayShort = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(new Date(utcMs));
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayShort);
  return WEEKDAY_NAMES[index >= 0 ? index : 0];
}
