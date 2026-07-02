import { describe, expect, it } from "vitest";
import {
  argentinaToSpainClock,
  conflictsWithBooked,
  CALL_DURATION_MINUTES,
  parseProposedCallTime,
  argentinaLabelFromMs
} from "@/application/callScheduling";

describe("argentinaToSpainClock (hora Argentina -> España)", () => {
  it("en VERANO español (junio, CEST) suma 5 horas: 18:00 AR -> 23:00 ES", () => {
    const r = argentinaToSpainClock(18, 0, new Date(Date.UTC(2026, 5, 23))); // 23-jun
    expect(r.label).toBe("23:00");
  });

  it("en INVIERNO español (enero, CET) suma 4 horas: 18:00 AR -> 22:00 ES", () => {
    const r = argentinaToSpainClock(18, 0, new Date(Date.UTC(2026, 0, 15))); // 15-ene
    expect(r.label).toBe("22:00");
  });

  it("conserva los minutos: 10:30 AR (junio) -> 15:30 ES", () => {
    const r = argentinaToSpainClock(10, 30, new Date(Date.UTC(2026, 5, 23)));
    expect(r.label).toBe("15:30");
  });

  it("cruza la medianoche correctamente: 21:00 AR (junio) -> 02:00 ES", () => {
    const r = argentinaToSpainClock(21, 0, new Date(Date.UTC(2026, 5, 23)));
    expect(r.label).toBe("02:00");
  });
});

describe("parseProposedCallTime: la candidata oye SU hora (Argentina), Alex ve la de España (23-jun)", () => {
  // Bug detectado en la auditoria: la candidata pedia "6 de la tarde" y el bot le confirmaba "23:00" (hora
  // de Espana). La cifra de Espana es para Alex (cuando llama); a la candidata se le confirma SU hora.
  const now = new Date(Date.UTC(2026, 5, 23, 10, 0)); // 23-jun, 07:00 en Argentina

  // jul-2026 (decisión de Alex): "a las 6" SIN franja = 18:00 argentina (nadie agenda una llamada comercial
  // a las 6 AM). Solo 1-8; "a las 10" sigue siendo 10:00; "6 de la mañana" explícita se respeta.
  it("'mañana a las 6' SIN franja -> 18:00 argentina (no 06:00 de la madrugada)", () => {
    const r = parseProposedCallTime("mañana a las 6", now);
    expect(r).not.toBeNull();
    expect(r!.labelAr).toContain("18:00");
  });

  it("'mañana a las 10' sigue siendo 10:00 y '6 de la mañana' explícita se respeta", () => {
    expect(parseProposedCallTime("mañana a las 10", now)!.labelAr).toContain("10:00");
    expect(parseProposedCallTime("mañana a las 6 de la mañana", now)!.labelAr).toContain("06:00");
  });

  it("'mañana a las 6 de la tarde' -> labelEs en Espana (23:00) y labelAr en Argentina (18:00)", () => {
    const r = parseProposedCallTime("mañana a las 6 de la tarde", now);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toContain("23:00");
    expect(r!.labelAr).toContain("18:00");
    expect(r!.labelAr).not.toContain("23:00");
  });

  it("argentinaLabelFromMs reconstruye la hora Argentina desde el instante real (UTC)", () => {
    const r = parseProposedCallTime("mañana a las 6 de la tarde", now)!;
    expect(argentinaLabelFromMs(r.startMsUtc)).toBe(r.labelAr);
  });
});

describe("conflictsWithBooked (no dos llamadas en la misma ventana de 30 min)", () => {
  const base = Date.UTC(2026, 5, 23, 21, 0); // una llamada reservada

  it("choca si es exactamente la misma hora", () => {
    expect(conflictsWithBooked(base, [base])).toBe(true);
  });

  it("choca si cae dentro de los 30 min de otra (a los 15 min)", () => {
    expect(conflictsWithBooked(base + 15 * 60_000, [base])).toBe(true);
  });

  it("NO choca si hay 30 min o más de separación", () => {
    expect(conflictsWithBooked(base + CALL_DURATION_MINUTES * 60_000, [base])).toBe(false);
    expect(conflictsWithBooked(base + 60 * 60_000, [base])).toBe(false);
  });

  it("sin reservas previas, nunca choca", () => {
    expect(conflictsWithBooked(base, [])).toBe(false);
  });
});
