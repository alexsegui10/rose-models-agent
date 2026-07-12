import { describe, it, expect } from "vitest";
import { computeAdPerformance, totalsOf } from "@/application/adPerformance";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// RENDIMIENTO POR ANUNCIO (Lote 3): agrupa candidatas por el anuncio de origen (adId/adTitle, ya persistidos)
// y calcula el embudo de CALIDAD por creatividad. Puro; la pestaña "Anuncios" solo lo pinta.

function mk(overrides: Partial<Candidate> & { instagramUsername: string }): Candidate {
  return normalizeCandidate({ ...createCandidate({ instagramUsername: overrides.instagramUsername }), ...overrides });
}

function withState(username: string, state: CandidateState, extra: Partial<Candidate> = {}): Candidate {
  return mk({ instagramUsername: username, currentState: state, ...extra });
}

describe("computeAdPerformance", () => {
  it("sin candidatas -> []", () => {
    expect(computeAdPerformance([])).toEqual([]);
  });

  it("agrupa por adId y usa el titulo como etiqueta", () => {
    const rows = computeAdPerformance([
      mk({ instagramUsername: "1", adId: "AD_A", adTitle: "AD 01 — Casting", currentState: "QUALIFYING" }),
      mk({ instagramUsername: "2", adId: "AD_A", adTitle: "AD 01 — Casting", currentState: "NEW_LEAD" })
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].adId).toBe("AD_A");
    expect(rows[0].label).toBe("AD 01 — Casting");
    expect(rows[0].leads).toBe(2);
    expect(rows[0].responded).toBe(1); // solo la que salio de NEW_LEAD
  });

  it("las candidatas sin anuncio caen en el bucket 'Organico' y va al final", () => {
    const rows = computeAdPerformance([
      mk({ instagramUsername: "1" }), // organica (sin adId)
      mk({ instagramUsername: "2", adId: "AD_A", adTitle: "AD 01", currentState: "QUALIFYING" })
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].adId).toBe("AD_A"); // el anuncio arriba
    expect(rows[1].isOrganic).toBe(true);
    expect(rows[1].label).toBe("Orgánico");
  });

  it("'Organico' va al final aunque tenga MAS leads (las creatividades quedan arriba)", () => {
    const rows = computeAdPerformance([
      mk({ instagramUsername: "o1" }),
      mk({ instagramUsername: "o2" }),
      mk({ instagramUsername: "o3" }),
      mk({ instagramUsername: "a1", adId: "AD_A", currentState: "QUALIFYING" })
    ]);
    expect(rows[0].adId).toBe("AD_A");
    expect(rows[1].isOrganic).toBe(true);
    expect(rows[1].leads).toBe(3);
  });

  it("cuenta aptas (APPROVED), llamadas completadas y descartadas", () => {
    const rows = computeAdPerformance([
      withState("1", "APPROVED", { adId: "AD_A", humanFitDecision: "APPROVED" }),
      withState("2", "CALL_COMPLETED", {
        adId: "AD_A",
        humanFitDecision: "APPROVED",
        lastCall: { result: "COMPLETED", summary: "", transcript: [], negotiatedModelShare: 65 }
      }),
      withState("3", "REJECTED", { adId: "AD_A", humanFitDecision: "REJECTED" }),
      withState("4", "CLOSED", { adId: "AD_A" })
    ]);
    const a = rows[0];
    expect(a.leads).toBe(4);
    expect(a.aptas).toBe(2); // las 2 APPROVED
    expect(a.callsCompleted).toBe(1); // la de CALL_COMPLETED
    expect(a.discarded).toBe(2); // REJECTED + CLOSED
  });

  it("% medio negociado: promedia solo las que tienen dato (de la llamada), redondeado", () => {
    const rows = computeAdPerformance([
      withState("1", "CALL_COMPLETED", {
        adId: "AD_A",
        lastCall: { result: "COMPLETED", summary: "", transcript: [], negotiatedModelShare: 70 }
      }),
      withState("2", "CALL_COMPLETED", {
        adId: "AD_A",
        lastCall: { result: "COMPLETED", summary: "", transcript: [], negotiatedModelShare: 60 }
      }),
      withState("3", "QUALIFYING", { adId: "AD_A" }) // sin dato -> no cuenta
    ]);
    expect(rows[0].avgNegotiatedShare).toBe(65); // (70+60)/2
  });

  it("% medio negociado null cuando nadie tiene dato", () => {
    const rows = computeAdPerformance([withState("1", "QUALIFYING", { adId: "AD_A" })]);
    expect(rows[0].avgNegotiatedShare).toBeNull();
  });

  it("tasas aptaRate = aptas/leads y callRate = completadas/aptas", () => {
    const rows = computeAdPerformance([
      withState("1", "APPROVED", { adId: "AD_A", humanFitDecision: "APPROVED" }),
      withState("2", "CALL_COMPLETED", {
        adId: "AD_A",
        humanFitDecision: "APPROVED",
        lastCall: { result: "COMPLETED", summary: "", transcript: [] }
      }),
      withState("3", "QUALIFYING", { adId: "AD_A" }),
      withState("4", "NEW_LEAD", { adId: "AD_A" })
    ]);
    expect(rows[0].aptaRate).toBeCloseTo(2 / 4);
    expect(rows[0].callRate).toBeCloseTo(1 / 2);
  });

  it("ordena las creatividades por leads desc, orgánico al final", () => {
    const rows = computeAdPerformance([
      withState("a1", "QUALIFYING", { adId: "AD_A" }),
      withState("b1", "QUALIFYING", { adId: "AD_B" }),
      withState("b2", "QUALIFYING", { adId: "AD_B" }),
      mk({ instagramUsername: "o1" })
    ]);
    expect(rows.map((r) => r.adId)).toEqual(["AD_B", "AD_A", "__organic__"]);
  });

  it("totalsOf suma el conjunto", () => {
    const rows = computeAdPerformance([
      withState("1", "APPROVED", { adId: "AD_A", humanFitDecision: "APPROVED" }),
      withState("2", "REJECTED", { adId: "AD_B", humanFitDecision: "REJECTED" })
    ]);
    const t = totalsOf(rows);
    expect(t.leads).toBe(2);
    expect(t.aptas).toBe(1);
    expect(t.discarded).toBe(1);
  });
});
