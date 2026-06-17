import { describe, expect, it } from "vitest";
import { buildCallContext, summarizeCallContext } from "@/application/callContext";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

function candidate(partial: Record<string, unknown>): Candidate {
  return normalizeCandidate({ ...createCandidate({ instagramUsername: "ctx_case" }), ...partial });
}

describe("contexto de la candidata para la llamada", () => {
  it("se construye desde la ficha (nombre, edad, país, OF, dudas, resumen del DM)", () => {
    const ctx = buildCallContext(
      candidate({
        firstName: "Lucía",
        age: 27,
        country: "España",
        hasOnlyFans: false,
        objections: ["desconfianza", "privacidad"],
        conversationSummary: "Preguntó cómo funciona y por el reparto."
      })
    );
    expect(ctx.candidateName).toBe("Lucía");
    expect(ctx.age).toBe(27);
    expect(ctx.country).toBe("España");
    expect(ctx.hasOnlyFans).toBe(false);
    expect(ctx.concerns).toEqual(expect.arrayContaining(["desconfianza", "privacidad"]));
    expect(ctx.dmSummary).toContain("reparto");
  });

  it("el resumen incluye nombre y dudas, pero NO el teléfono (dato sensible innecesario)", () => {
    const ctx = buildCallContext(candidate({ firstName: "Ana", phone: "+34600111222", objections: ["privacidad"] }));
    const s = summarizeCallContext(ctx);
    expect(s).toContain("Ana");
    expect(s.toLowerCase()).toContain("privacidad");
    expect(s).not.toContain("600111222");
  });

  it("sin datos opcionales no rompe (concerns siempre es lista)", () => {
    const ctx = buildCallContext(candidate({}));
    expect(Array.isArray(ctx.concerns)).toBe(true);
    expect(ctx.concerns).toHaveLength(0);
  });
});
