import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

// Regresión (auditoría E2E 15-jul, voz): la conjunción causal "porque" ("hago changas PORQUE no tengo fijo")
// caía en QUESTION -> asks-unknown -> el bot difería al WhatsApp un "detalle" inexistente (defer-chirp). El
// interrogativo real ("¿por qué no me pagan?") lleva "?" y sigue contando como pregunta.

describe("el 'porque' causal no es una pregunta (auditoría 15-jul, voz)", () => {
  it("'hago changas porque no tengo nada fijo' NO se clasifica como pregunta (asks-unknown)", () => {
    const signal = classifyCallSignal({ utterance: "hago changas porque no tengo nada fijo", isCoveredQuestion: false });
    expect(signal).not.toBe("asks-unknown");
    expect(signal).not.toBe("asks-covered");
  });

  it("'estoy en casa con los nenes porque no consigo laburo' tampoco es pregunta", () => {
    const signal = classifyCallSignal({
      utterance: "estoy en casa con los nenes porque no consigo laburo",
      isCoveredQuestion: false
    });
    expect(signal).not.toBe("asks-unknown");
    expect(signal).not.toBe("asks-covered");
  });

  it("un interrogativo real ('por que no me pagan?') SIGUE siendo pregunta", () => {
    const signal = classifyCallSignal({ utterance: "por que no me pagan?", isCoveredQuestion: false });
    expect(signal).toBe("asks-unknown");
  });

  it("interrogativo junto ('porque me pagan tan poco?') con '?' sigue siendo pregunta", () => {
    const signal = classifyCallSignal({ utterance: "porque me pagan tan poco?", isCoveredQuestion: false });
    expect(signal).toBe("asks-unknown");
  });
});
