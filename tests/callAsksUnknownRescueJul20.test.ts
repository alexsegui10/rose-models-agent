import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallUnderstander, CallUnderstoodIntent } from "@/application/callUnderstander";

// Opción A "más IA" (Alex 20-jul): antes de DIFERIR a WhatsApp (asks-unknown), la comprensión IA intenta
// entender la intención y RESCATA el over-defer ("responde lo que pregunta"). Solo se aplica si el efecto de
// estado es idéntico al del asks-unknown determinista -> replay-safe; los rescates que mutan estado se descartan.

const opened: CallChatMessage[] = [
  { role: "system", content: "prompt del agente" },
  { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" }
];
// Pregunta que el oído determinista NO cubre ni reconoce como intención conocida -> asks-unknown.
const UNKNOWN_Q = "oye y eso influye en mi horóscopo chino o qué";

function understanderReturning(intent: CallUnderstoodIntent | null): CallUnderstander {
  return { understand: async () => intent };
}

describe("Opción A: rescate IA del over-defer en asks-unknown (replay-safe)", () => {
  it("baseline: sin understander, un asks-unknown DIFIERE (comportamiento de siempre)", async () => {
    const res = await respondToCall({ messages: [...opened, { role: "user", content: UNKNOWN_Q }] });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
  });

  it("la IA lo entiende como INGRESOS -> responde (no defiere)", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: UNKNOWN_Q }],
      understander: understanderReturning("earnings")
    });
    expect(res.directiveType).toBe("GIVE_EARNINGS");
  });

  it("la IA lo entiende como IDENTIDAD -> responde quién es (no defiere)", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: UNKNOWN_Q }],
      understander: understanderReturning("identity")
    });
    expect(res.directiveType).toBe("GIVE_IDENTITY");
  });

  it("la IA NO lo entiende (none) -> sigue difiriendo (defer seguro)", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: UNKNOWN_Q }],
      understander: understanderReturning("none")
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
  });

  it("face-concern NO tiene rama de rescate -> sigue difiriendo (la cara la maneja el director aparte)", async () => {
    // Nota: difiere por AUSENCIA de rama de rescate para face-concern (no por el guard). El guard de
    // estado-idéntico es defensa-en-profundidad: hoy resolveRefinedSignal no emite ninguna señal que mute
    // estado, así que nunca llega a rechazar; queda como red si en el futuro se añade una.
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: UNKNOWN_Q }],
      understander: understanderReturning("face-concern")
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
  });

  // REGRESIÓN (revisor 20-jul, bug nº7): los IMPUESTOS se difieren a Alex A PROPÓSITO (aunque el retriever los
  // "cubra"); el rescate NO debe reabrir ese bug respondiendo con la FAQ de cuotas.
  it("una pregunta de IMPUESTOS NO se rescata aunque la IA la entienda -> sigue difiriendo (deferencia deliberada)", async () => {
    for (const intent of ["question", "earnings"] as const) {
      const res = await respondToCall({
        messages: [...opened, { role: "user", content: "y con los impuestos como es, tengo que pagar algo" }],
        understander: understanderReturning(intent)
      });
      expect(res.directiveType, `intent=${intent}`).toBe("DEFER_TO_PARTNER");
    }
  });
});
