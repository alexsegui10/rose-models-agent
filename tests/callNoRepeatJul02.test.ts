import { describe, expect, it } from "vitest";
import { planCallUtterance } from "@/application/callRedaction";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// Anti-BUCLE de formulación (2-jul, feedback de Alex: "está lleno de bucles"): el sistema sabe qué ya
// dijo — si una directiva se repite, usa una VARIANTE determinista distinta (nunca la misma frase
// idéntica dos veces). Todas las variantes respetan los invariantes (sin cifras nuevas, sin promesas).

describe("redacción: variantes deterministas por repetición", () => {
  it("ASK_REPEAT cambia de frase a la segunda y tercera vez", () => {
    const first = planCallUtterance({ directive: { type: "ASK_REPEAT" }, repetitionIndex: 0 });
    const second = planCallUtterance({ directive: { type: "ASK_REPEAT" }, repetitionIndex: 1 });
    const third = planCallUtterance({ directive: { type: "ASK_REPEAT" }, repetitionIndex: 2 });
    expect(first.deterministicText).not.toBe(second.deterministicText);
    expect(second.deterministicText).not.toBe(third.deterministicText);
  });

  it("GIVE_EARNINGS repetido cambia la formulación y sigue sin cifras ni promesas", () => {
    const first = planCallUtterance({ directive: { type: "GIVE_EARNINGS" }, repetitionIndex: 0 });
    const second = planCallUtterance({ directive: { type: "GIVE_EARNINGS" }, repetitionIndex: 1 });
    expect(first.deterministicText).not.toBe(second.deterministicText);
    for (const plan of [first, second]) {
      expect(plan.deterministicText!).not.toMatch(/\d/);
      expect(plan.deterministicText!.toLowerCase()).not.toContain("prometo");
    }
  });

  it("el CIERRE repetido usa la versión corta (no vuelve a soltar el discurso entero) y sigue mencionando el contrato", () => {
    const first = planCallUtterance({ directive: { type: "CLOSE_WITH_CONTRACT" }, repetitionIndex: 0 });
    const second = planCallUtterance({ directive: { type: "CLOSE_WITH_CONTRACT" }, repetitionIndex: 1 });
    expect(second.deterministicText).not.toBe(first.deterministicText);
    expect(second.deterministicText!.length).toBeLessThan(first.deterministicText!.length);
    expect(second.deterministicText!.toLowerCase()).toContain("contrato");
  });

  it("el corte por MENOR repetido mantiene la firmeza ('mayores de edad') en su variante", () => {
    const second = planCallUtterance({ directive: { type: "CLOSE_UNDERAGE" }, repetitionIndex: 1 });
    expect(second.deterministicText!.toLowerCase()).toContain("mayores de edad");
    expect(second.deterministicText!.toLowerCase()).not.toContain("te sigo contando");
  });

  it("GIVE_AGE_POLICY NO varía (firmeza idéntica deliberada, invariante 2)", () => {
    const first = planCallUtterance({ directive: { type: "GIVE_AGE_POLICY" }, repetitionIndex: 0 });
    const second = planCallUtterance({ directive: { type: "GIVE_AGE_POLICY" }, repetitionIndex: 5 });
    expect(second.deterministicText).toBe(first.deterministicText);
  });

  it("un índice de repetición fuera de rango se queda en la última variante (no explota)", () => {
    const plan = planCallUtterance({ directive: { type: "ASK_REPEAT" }, repetitionIndex: 99 });
    expect((plan.deterministicText ?? "").length).toBeGreaterThan(0);
  });

  it("los briefs del redactor avisan de la repetición (OTRA formulación)", () => {
    const repeated = planCallUtterance({
      directive: { type: "DEFER_TO_PARTNER" },
      repetitionIndex: 1
    });
    expect(repeated.draftingBrief!.instruction).toContain("OTRA formulación");
    const fresh = planCallUtterance({ directive: { type: "DEFER_TO_PARTNER" }, repetitionIndex: 0 });
    expect(fresh.draftingBrief!.instruction).not.toContain("OTRA formulación");
  });
});

describe("responder end-to-end: el replay cuenta las repeticiones y varía las frases", () => {
  it("dos 'no te entiendo' seguidos -> dos peticiones de repetir DISTINTAS", async () => {
    const base: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];
    const one = await respondToCall({ messages: [...base, { role: "user", content: "kjsdf qqq brzzz" }] });
    expect(one.directiveType).toBe("ASK_REPEAT");
    const two = await respondToCall({
      messages: [
        ...base,
        { role: "user", content: "kjsdf qqq brzzz" },
        { role: "assistant", content: one.content },
        { role: "user", content: "www zzz kkkjj" }
      ]
    });
    expect(two.directiveType).toBe("ASK_REPEAT");
    expect(two.content).not.toBe(one.content);
    expect(two.content.trim().length).toBeGreaterThan(0);
  });

  it("dos preguntas de ingresos -> dos respuestas honestas DISTINTAS (ninguna con cifras)", async () => {
    const base: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];
    const one = await respondToCall({ messages: [...base, { role: "user", content: "¿cuánto ganaría yo al mes?" }] });
    expect(one.directiveType).toBe("GIVE_EARNINGS");
    const two = await respondToCall({
      messages: [
        ...base,
        { role: "user", content: "¿cuánto ganaría yo al mes?" },
        { role: "assistant", content: one.content },
        { role: "user", content: "ya pero más o menos cuánto se gana" }
      ]
    });
    expect(two.directiveType).toBe("GIVE_EARNINGS");
    expect(two.content).not.toBe(one.content);
    expect(two.content).not.toMatch(/\d/);
  });
});
