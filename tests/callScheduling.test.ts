import { describe, expect, it } from "vitest";
import { argentinaToSpainClock, conflictsWithBooked, CALL_DURATION_MINUTES } from "@/application/callScheduling";

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
