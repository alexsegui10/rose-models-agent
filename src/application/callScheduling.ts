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
 * Zona horaria de la candidata, decidida por el PREFIJO de su teléfono (lanzamiento 3-jul: a una
 * candidata española +34 se le interpretaba "a las 18" como hora ARGENTINA y la llamada salía 5 horas
 * tarde). +34/0034 (o 34 + móvil español de 9 dígitos) -> España; +54 y todo lo demás (incluidos los
 * números sin prefijo) -> Argentina, el país del anuncio.
 */
export type CandidateCallZone = "AR" | "ES";

export function candidateZoneFromPhone(phone: string | null | undefined): CandidateCallZone {
  const compact = (phone ?? "").replace(/[\s\-().]/g, "");
  if (/^(?:\+34|0034)\d{6,}$/.test(compact) || /^34[67]\d{8}$/.test(compact)) return "ES";
  return "AR";
}

// Offset de Madrid (local - UTC, en ms) en un instante dado, vía Intl (respeta el DST español).
function madridOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const wallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"));
  return wallAsUtc - utcMs;
}

// Instante UTC de una hora de PARED de Madrid (doble pasada para acertar el offset aunque el día caiga
// junto a un cambio de hora).
function madridWallClockToUtcMs(year: number, monthIndex: number, day: number, hour: number, minute: number): number {
  const naive = Date.UTC(year, monthIndex, day, hour, minute);
  let utc = naive - madridOffsetMs(naive);
  utc = naive - madridOffsetMs(utc);
  return utc;
}

// Componentes de fecha del día ACTUAL en el calendario de Madrid (para resolver "hoy/mañana" de una
// candidata española: a las 23:30 UTC en Madrid ya es el día siguiente).
function madridDateComponents(now: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Madrid",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month") - 1, day: get("day") };
}

// "HH:MM" de pared en Madrid para un instante UTC.
function madridClockLabel(utcMs: number): string {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(utcMs));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

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
 * Calcula el día (en el CALENDARIO de la candidata: Argentina o España según su zona) sobre el que cae
 * la propuesta, a partir de `now` (instante UTC) y del texto. "hoy/manana/pasado" son relativos al día
 * actual EN SU zona; "[proximo] lunes..domingo" salta al PRÓXIMO día de esa semana (estrictamente futuro
 * respecto a hoy en su zona). Si no hay marcador de día, asume HOY.
 */
function resolveCandidateDate(message: string, now: Date, zone: CandidateCallZone): { year: number; month: number; day: number } {
  let todayUtcMidnight: number;
  if (zone === "ES") {
    // Día actual en el calendario de Madrid (con su DST, vía Intl).
    const madrid = madridDateComponents(now);
    todayUtcMidnight = Date.UTC(madrid.year, madrid.month, madrid.day);
  } else {
    // Día actual en Argentina (UTC-3): el instante UTC menos 3h da la hora de pared argentina.
    const argentinaNowMs = now.getTime() + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60_000;
    const argentinaNow = new Date(argentinaNowMs);
    todayUtcMidnight = Date.UTC(argentinaNow.getUTCFullYear(), argentinaNow.getUTCMonth(), argentinaNow.getUTCDate());
  }

  // "de/por la manana" es la FRANJA del dia (8 de la manana), NO el dia "manana" (tomorrow): se elimina
  // antes de detectar el marcador de dia para no agendar tomorrow cuando dicen "a las 8 de la manana".
  // Ídem "esta manana" (= hoy por la manana), que si no se colaba como el dia de manana (17-jul).
  // "a la manana" es muy argentino ("manana a la manana") y tambien es FRANJA, no el dia (revisor 17-jul).
  const dayMessage = message.replace(/\b(?:de|por|a|en) la manana\b/g, " ").replace(/\besta manana\b/g, " ");
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
 * FRANJAS del dia -> hora concreta, en hora de ELLA (DECISION DE ALEX, 17-jul, tras su prueba real).
 *
 * Las candidatas casi nunca dan una hora de reloj: dicen "manana despues de comer" o "por la tarde". Eso
 * antes NO se agendaba (el parser exigia hora exacta) -> no habia cita -> el marcador no llamaba nunca y la
 * candidata se quedaba esperando. Alex: "el problema es que casi siempre dicen manana despues de comer o al
 * mediodia, no siempre dicen horas exactas". Ahora se traduce a una hora concreta y el bot se la CONFIRMA
 * ("te llamo manana a las 3 entonces") para que ella pueda corregir si no le va.
 *
 * Solo se usan si NO hay hora exacta: "manana a las 8 de la manana" son las 8, no las 11.
 */
const DAY_SLOT_HOURS: ReadonlyArray<{ pattern: RegExp; hour: number }> = [
  // "despues de comer" va PRIMERO: es mas especifico que "mediodia" y pueden aparecer juntos.
  { pattern: /\b(?:despues de|tras|acabando de|acabar de|luego de) (?:comer|almorzar)\b|\bsobremesa\b/, hour: 15 },
  { pattern: /\bmediodia\b/, hour: 13 },
  { pattern: /\b(?:por|en|a|de) la manana\b|\bpor las mananas\b|\besta manana\b/, hour: 11 },
  { pattern: /\b(?:por|en|a|de) la tarde\b|\bpor las tardes\b|\besta tarde\b/, hour: 17 },
  { pattern: /\b(?:por|en|a|de) la noche\b|\bpor las noches\b|\besta noche\b/, hour: 21 }
];

function parseDaySlotHour(message: string): { hour: number; minute: number } | null {
  for (const slot of DAY_SLOT_HOURS) {
    if (slot.pattern.test(message)) return { hour: slot.hour, minute: 0 };
  }
  return null;
}

/**
 * "AHORA / en 5 minutos / en media hora" -> minutos desde ya (DECISION DE ALEX, 17-jul). En su prueba real
 * ella dijo "ahora en 5 minutos", el bot respondio "te llamo en un rato"... y no la llamo NUNCA, porque sin
 * hora no se agendaba nada. Ahora se agenda de verdad y el marcador la llama.
 */
function parseRelativeMinutes(message: string): number | null {
  // Un "ahora" DESCRIPTIVO no es una propuesta de hora: "ahora trabajo de camarera", "ahora te paso el
  // numero". Sin este guard el bot agendaba una llamada REAL en 5 minutos por esas frases (bloqueante del
  // revisor 17-jul, reproducido E2E). Y si ella nombra un DIA o una FRANJA ("ahora estoy liada, manana por
  // la tarde"), manda eso: el "ahora" es contexto, no la cita.
  // "en N minutos / en media hora / en un cuarto de hora / en una hora" son propuestas INEQUIVOCAS: van ANTES
  // del guard de dia, porque si no "hoy en media hora" se perdia (nota del revisor 17-jul).
  const explicit = message.match(/\ben\s+(\d{1,3})\s*(?:min\w*)\b/);
  if (explicit) {
    const minutes = Number(explicit[1]);
    // Tope de 3h: "en 5 minutos" si, "en 500 minutos" es ruido (y una hora de reloj la caza el otro parser).
    if (minutes >= 1 && minutes <= 180) return minutes;
  }
  if (/\ben (?:un )?cuarto de hora\b/.test(message)) return 15;
  if (/\ben media hora\b/.test(message)) return 30;
  if (/\ben (?:un|una) hora\b/.test(message)) return 60;

  if (/\b(?:manana|pasado|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/.test(message)) return null;
  if (DAY_SLOT_HOURS.some((slot) => slot.pattern.test(message))) return null;

  // "ahora"/"ya" SUELTOS solo cuentan si son la PROPUESTA: o el mensaje es basicamente eso ("ahora mismo"),
  // o van pegados a un marcador de propuesta ("ahora puedo", "llamame ahora", "ahora si quieres", "ahora me
  // va bien"). Un "ahora" en mitad de una frase descriptiva NO agenda nada.
  if (/^\s*(?:ahora|ya|ahora mismo|ya mismo|enseguida|en un rato|en un ratito)[\s.!¡,]*$/.test(message)) return 5;
  if (
    /\b(?:ahora|ya)\b[\s,]*(?:mismo\b)?[\s,]*(?:puedo|podria|me va bien|me viene bien|si quieres|si te va|estoy libre|vale)\b/.test(
      message
    ) ||
    /\b(?:llamame|llamarme|llama|me llamas|puedes llamarme|podeis llamarme)\b[^.!?]{0,15}\b(?:ahora|ya|enseguida|en un rato)\b/.test(
      message
    )
  ) {
    return 5;
  }
  return null;
}

/**
 * Extrae la hora de pared ARGENTINA (hour 0-23, minute) del mensaje, o null si no hay hora clara.
 * Soporta: "las 18", "6pm", "6 de la tarde", "18:30", "10.30am", "a las 10". Las palabras de franja
 * sueltas ("por las tardes", "por la noche") NO cuentan como hora concreta aqui: las traduce
 * `parseDaySlotHour` con las horas que fijo Alex.
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
    // jul-2026 (decisión de Alex): "a las 6" SIN franja = 18:00 argentina — nadie agenda una llamada
    // comercial a las 6 de la madrugada. Solo 1-8 ("a las 9/10/11" siguen siendo mañana literal); si
    // dice mañana/madrugada explícita, se respeta tal cual.
    if (hour <= 8 && !/\b(de la manana|por la manana|de la madrugada|por la madrugada)\b/.test(context)) {
      return hour + 12;
    }
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
/**
 * Label en hora de pared ARGENTINA (la de la candidata) para un instante UTC dado: "el lunes a las 18:00".
 * Argentina es UTC-3 fijo, asi que basta restar 3h al instante UTC. Se usa para CONFIRMAR a la candidata SU
 * hora (la que ella dio), mientras `labelEs` queda para Alex/CRM (cuando el llama). Sin esto el bot le decia
 * la hora de Espana ("23:00" cuando ella pidio "las 6"), confundiendola (bug auditoria 23-jun).
 */
export function argentinaLabelFromMs(startMsUtc: number): string {
  const argentina = new Date(startMsUtc + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60_000);
  const weekday = WEEKDAY_NAMES[argentina.getUTCDay()];
  const hh = String(argentina.getUTCHours()).padStart(2, "0");
  const mm = String(argentina.getUTCMinutes()).padStart(2, "0");
  return `el ${weekday} a las ${hh}:${mm}`;
}

/**
 * Label en la hora de PARED de la CANDIDATA (según su zona por prefijo) para un instante UTC:
 * "el lunes a las 18:00". Es lo que se le confirma/recuerda a ELLA; `labelEs` queda para Alex/CRM.
 */
export function candidateLabelFromMs(startMsUtc: number, zone: CandidateCallZone): string {
  if (zone === "ES") {
    return `el ${spainWeekday(startMsUtc)} a las ${madridClockLabel(startMsUtc)}`;
  }
  return argentinaLabelFromMs(startMsUtc);
}

/** Hora local (0-23) de la candidata en un instante UTC (franja horaria para no llamar de madrugada). */
export function candidateLocalHour(utcMs: number, zone: CandidateCallZone): number {
  if (zone === "ES") {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", hour: "2-digit", hour12: false }).formatToParts(
      new Date(utcMs)
    );
    return Number(parts.find((part) => part.type === "hour")?.value ?? "0") % 24;
  }
  return new Date(utcMs + ARGENTINA_UTC_OFFSET_HOURS * 60 * 60_000).getUTCHours();
}

export function parseProposedCallTime(
  message: string,
  now: Date,
  zone: CandidateCallZone = "AR",
  // Traducir una FRANJA vaga ("manana por la tarde") a la hora concreta de Alex es OPT-IN a proposito: por
  // defecto NO, para respetar su decision del 23-jun (ante una franja, el bot insiste UNA vez en la hora
  // exacta). Solo se activa cuando ella YA insistio y la franja se ACEPTA (resolveVagueCallWindow): ahi Alex
  // prefiere que el bot la llame en esa franja a dejarsela a mano (decision 17-jul).
  options: { resolveDaySlot?: boolean } = {}
): { startMsUtc: number; labelEs: string; labelAr: string; labelCandidate: string } | null {
  const normalized = normalizeForParse(message);

  // Propuesta negada ("el viernes no puedo", "ahora no, manana tampoco"): no se agenda nada.
  if (NEGATED_TIME_PATTERN.test(normalized)) {
    return null;
  }

  // "ahora / en 5 minutos / en media hora": no lleva dia ni hora de reloj, se resuelve desde YA (Alex 17-jul).
  const relativeMinutes = parseRelativeMinutes(normalized);
  if (relativeMinutes !== null && !parseArgentinaHour(normalized)) {
    const startMsUtc = now.getTime() + relativeMinutes * 60_000;
    return {
      startMsUtc,
      labelEs: `el ${spainWeekday(startMsUtc)} a las ${madridClockLabel(startMsUtc)}`,
      labelAr: argentinaLabelFromMs(startMsUtc),
      labelCandidate: candidateLabelFromMs(startMsUtc, zone)
    };
  }

  // Hora de reloj si la hay; si no, la FRANJA que dijo, pero SOLO si se pidio resolverla (ver options arriba).
  const time = parseArgentinaHour(normalized) ?? (options.resolveDaySlot ? parseDaySlotHour(normalized) : null);
  if (!time) {
    return null;
  }

  const date = resolveCandidateDate(normalized, now, zone);
  // Instante UTC de esa hora de PARED en la zona de la candidata: Argentina es UTC-3 fijo (AR + 3h);
  // España va con su DST vía Intl (lanzamiento 3-jul: a una +34 se le agendaba en hora argentina).
  const startMsUtc =
    zone === "ES"
      ? madridWallClockToUtcMs(date.year, date.month, date.day, time.hour, time.minute)
      : Date.UTC(date.year, date.month, date.day, time.hour - ARGENTINA_UTC_OFFSET_HOURS, time.minute);
  // No agendar en el PASADO: "hoy a las 10" cuando ya son las 11 (sin marcador de dia futuro) es ambiguo;
  // devolvemos null para que el bot vuelva a pedir la hora en vez de agendar una cita ya pasada.
  if (startMsUtc <= now.getTime()) {
    return null;
  }
  // labelEs: hora de España (la que vive Alex/el CRM), derivada del instante real. labelCandidate: SU
  // hora (la que se le confirma a ella). labelAr se mantiene por compatibilidad: es SIEMPRE la lectura
  // argentina del instante (== labelCandidate cuando la zona es AR).
  const labelEs = `el ${spainWeekday(startMsUtc)} a las ${madridClockLabel(startMsUtc)}`;
  const labelAr = argentinaLabelFromMs(startMsUtc);
  const labelCandidate = candidateLabelFromMs(startMsUtc, zone);
  return { startMsUtc, labelEs, labelAr, labelCandidate };
}

// Día de la semana (en español, sin acentos) en el huso de España para un instante UTC dado.
function spainWeekday(utcMs: number): string {
  const dayShort = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" }).format(new Date(utcMs));
  const index = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dayShort);
  return WEEKDAY_NAMES[index >= 0 ? index : 0];
}
