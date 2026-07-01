import { describe, expect, it } from "vitest";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// Saneo defensivo: una fila corrupta (edad/ingresos fuera de rango) NO debe tirar el parse de toda la lista
// del CRM. Se deja el campo vacio (desconocido). Invariante 2 intacto: una edad real de menor se conserva.
describe("normalizeCandidate: saneo de numericos fuera de rango", () => {
  function build(overrides: Record<string, unknown>) {
    const base = createCandidate({ instagramUsername: "sanit" });
    return normalizeCandidate({ ...base, ...overrides } as Parameters<typeof normalizeCandidate>[0]);
  }

  it("edad 0 / negativa / no entera -> undefined (no revienta el parse)", () => {
    expect(build({ age: 0 }).age).toBeUndefined();
    expect(build({ age: -5 }).age).toBeUndefined();
    expect(build({ age: 25.5 }).age).toBeUndefined();
    expect(build({ age: Number.NaN }).age).toBeUndefined();
  });

  it("edad valida se conserva, incluida la de una MENOR (invariante 2 intacto)", () => {
    expect(build({ age: 25 }).age).toBe(25);
    expect(build({ age: 16 }).age).toBe(16);
  });

  it("ingresos negativos -> undefined; validos (incluido 0) se conservan", () => {
    expect(build({ currentMonthlyRevenue: -100 }).currentMonthlyRevenue).toBeUndefined();
    expect(build({ currentMonthlyRevenue: 0 }).currentMonthlyRevenue).toBe(0);
    expect(build({ currentMonthlyRevenue: 500 }).currentMonthlyRevenue).toBe(500);
  });
});
