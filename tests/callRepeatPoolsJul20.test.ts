import { describe, expect, it } from "vitest";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// Barrido de voz 20-jul (#3/#4): NO_SALARY_TEXTS y el pool inline de GIVE_SHARE_FIGURE tenían solo 2
// variantes; como esas directivas NO cambian estado, si la candidata insiste el bot repetía la 2ª clavada
// desde la 3ª vez (tell de IA). Ahora 3 variantes cada uno (como DEFER/ASK_REPEAT), todas seguras.

function noSalary(i: number): string {
  const plan = planCallUtterance({ directive: { type: "GIVE_NO_SALARY" }, repetitionIndex: i } as never);
  return plan.deterministicText ?? plan.fallbackText ?? "";
}
function shareFigure(i: number): string {
  const plan = planCallUtterance({
    directive: { type: "GIVE_SHARE_FIGURE", shareOffer: { modelShare: 30, agencyShare: 70 } },
    repetitionIndex: i
  } as never);
  return plan.deterministicText ?? plan.fallbackText ?? "";
}

describe("GIVE_NO_SALARY: 3 variantes distintas y seguras (no repite hasta la 4ª)", () => {
  it("las 3 primeras son DISTINTAS", () => {
    const texts = [noSalary(0), noSalary(1), noSalary(2)];
    expect(new Set(texts).size).toBe(3);
  });
  it("todas pasan el validador y ninguna promete sueldo fijo ni cifra nueva", () => {
    for (let i = 0; i < 3; i += 1) {
      const t = noSalary(i);
      expect(validateCallUtterance(t).valid, t).toBe(true);
      expect(t.toLowerCase()).toMatch(/porcentaje|no.*(fijo|sueldo)/); // sigue diciendo que NO hay fijo
    }
  });
});

describe("GIVE_SHARE_FIGURE: 3 variantes distintas, todas con la cifra AUTORIZADA", () => {
  it("las 3 primeras son DISTINTAS", () => {
    const texts = [shareFigure(0), shareFigure(1), shareFigure(2)];
    expect(new Set(texts).size).toBe(3);
  });
  it("todas dicen 30/70 (la del director) y pasan el validador; nunca invierten el reparto", () => {
    for (let i = 0; i < 3; i += 1) {
      const t = shareFigure(i);
      expect(validateCallUtterance(t).valid, t).toBe(true);
      expect(t).toContain("30%");
      expect(t).toContain("70%");
    }
  });
});
