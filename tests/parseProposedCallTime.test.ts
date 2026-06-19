import { describe, expect, it } from "vitest";
import { parseProposedCallTime, argentinaToSpainClock } from "@/application/callScheduling";

// parseProposedCallTime: parser DETERMINISTA de la hora que propone la candidata (en hora Argentina).
// Resuelve dia relativo (hoy/manana/pasado/proximo [dia]) + hora y convierte a hora de Espana. Devuelve
// null si no hay hora clara, si la hora esta negada, o si es vago. NO usa OpenAI (invariante 1).

// "now" de referencia: un MARTES 23-jun-2026, 12:00 hora Argentina (15:00 UTC). En esa fecha Espana esta
// en horario de verano (CEST): la diferencia AR->ES es de 5 horas.
const NOW_AR_TUESDAY = new Date(Date.UTC(2026, 5, 23, 15, 0)); // 23-jun-2026 15:00 UTC = 12:00 AR

describe("parseProposedCallTime (verano espanol: AR + 5h)", () => {
  it("'manana a las 18' -> miercoles 24-jun, 18:00 AR = 23:00 ES", () => {
    const r = parseProposedCallTime("manana a las 18", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toBe("el miercoles a las 23:00");
    // 18:00 AR del 24-jun = 21:00 UTC del 24-jun.
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 24, 21, 0));
  });

  it("'hoy a las 6pm' -> hoy martes 23-jun, 18:00 AR = 23:00 ES", () => {
    const r = parseProposedCallTime("hoy a las 6pm", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toBe("el martes a las 23:00");
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 23, 21, 0));
  });

  it("'mañana a las 10:30am' conserva minutos (10:30 AR = 15:30 ES)", () => {
    const r = parseProposedCallTime("mañana a las 10:30am", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toBe("el miercoles a las 15:30");
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 24, 13, 30));
  });

  it("'el proximo lunes a las 18:30' -> lunes 29-jun (no el de hoy)", () => {
    const r = parseProposedCallTime("el proximo lunes a las 18:30", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toBe("el lunes a las 23:30");
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 29, 21, 30));
  });

  it("'el lunes a las 18' (sin 'proximo') -> proximo lunes 29-jun", () => {
    const r = parseProposedCallTime("el lunes a las 18", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 29, 21, 0));
  });

  it("'pasado manana a las 20' -> jueves 25-jun", () => {
    const r = parseProposedCallTime("pasado manana a las 20", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 25, 23, 0));
  });

  it("'a las 18' sin dia -> hoy (martes 23-jun)", () => {
    const r = parseProposedCallTime("vale, a las 18 entonces", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 23, 21, 0));
  });

  it("'6 de la tarde' -> 18:00 AR", () => {
    const r = parseProposedCallTime("manana a las 6 de la tarde", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 24, 21, 0));
  });

  it("formato '18.30' (punto) tambien vale", () => {
    const r = parseProposedCallTime("manana 18.30", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 5, 24, 21, 30));
  });
});

describe("parseProposedCallTime (invierno espanol: AR + 4h)", () => {
  // now: viernes 16-ene-2026 12:00 AR. En enero Espana esta en horario de invierno (CET): AR->ES +4h.
  const NOW_AR_WINTER = new Date(Date.UTC(2026, 0, 16, 15, 0)); // 16-ene-2026 15:00 UTC = 12:00 AR

  it("'hoy a las 18' -> 18:00 AR = 22:00 ES en invierno", () => {
    const r = parseProposedCallTime("hoy a las 18", NOW_AR_WINTER);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toBe("el viernes a las 22:00");
    expect(r!.startMsUtc).toBe(Date.UTC(2026, 0, 16, 21, 0));
  });
});

describe("parseProposedCallTime: casos que devuelven null", () => {
  it("hora negada ('el viernes no puedo') -> null", () => {
    expect(parseProposedCallTime("el viernes no puedo", NOW_AR_TUESDAY)).toBeNull();
  });

  it("'ahora no, manana tampoco' (todo negado) -> null", () => {
    expect(parseProposedCallTime("ahora no, manana tampoco", NOW_AR_TUESDAY)).toBeNull();
  });

  it("vago: 'por las tardes' -> null (no hay hora concreta)", () => {
    expect(parseProposedCallTime("me viene mejor por las tardes", NOW_AR_TUESDAY)).toBeNull();
  });

  it("vago: 'cuando quieras' -> null (sin hora)", () => {
    expect(parseProposedCallTime("cuando quieras, me da igual", NOW_AR_TUESDAY)).toBeNull();
  });

  it("mensaje sin nada de hora -> null", () => {
    expect(parseProposedCallTime("vale perfecto gracias", NOW_AR_TUESDAY)).toBeNull();
  });

  it("solo un dia sin hora ('el lunes') -> null", () => {
    expect(parseProposedCallTime("el lunes", NOW_AR_TUESDAY)).toBeNull();
  });
});

describe("parseProposedCallTime: coherente con argentinaToSpainClock", () => {
  it("el label usa exactamente la conversion de argentinaToSpainClock", () => {
    const r = parseProposedCallTime("manana a las 21", NOW_AR_TUESDAY);
    expect(r).not.toBeNull();
    // 21:00 AR del 24-jun -> argentinaToSpainClock para esa fecha.
    const spain = argentinaToSpainClock(21, 0, new Date(Date.UTC(2026, 5, 24)));
    expect(r!.labelEs).toContain(spain.label);
  });
});
