import { describe, expect, it } from "vitest";
import { bridgeBackToQuestion } from "@/application/conversationEngine";

// Alex 16-jul: al re-preguntar un dato que no contestó ("¿qué móvil tienes?"), NO clavarlo dos veces igual,
// sino variar el puente ("y volviendo a lo del móvil…", "ah, una cosa que me faltaba…"). El puente rota por
// el nº de turnos del bot. Siempre a más (variar), nunca clavado.

const Q = "Que movil tienes?";

describe("el puente al re-preguntar un dato varía, no sale clavado (Alex 16-jul)", () => {
  it("re-preguntas en turnos distintos usan un puente DISTINTO", () => {
    const a = bridgeBackToQuestion(Q, 0);
    const b = bridgeBackToQuestion(Q, 1);
    const c = bridgeBackToQuestion(Q, 2);
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
    // Todas siguen conteniendo el dato que se re-pregunta.
    for (const r of [a, b, c]) expect(r.toLowerCase()).toContain("movil");
  });

  it("sigue poniendo un puente natural (no la pregunta cruda) y es replay-safe (mismo índice = mismo texto)", () => {
    const first = bridgeBackToQuestion(Q, 0);
    expect(first).not.toBe(Q); // hay puente, no la pregunta a secas
    expect(bridgeBackToQuestion(Q, 0)).toBe(first); // determinista para el mismo índice
    expect(bridgeBackToQuestion(Q, 3)).toBe(bridgeBackToQuestion(Q, 0)); // rota en ciclo (3 % 3 = 0)
  });
});
