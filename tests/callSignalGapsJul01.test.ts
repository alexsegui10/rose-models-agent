import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";

// Regresión de los gaps que cazó el simulador de llamada (1-jul-2026), con frases REALES de la prueba de Alex.
describe("clasificador de llamada: gaps del simulador (jul-2026)", () => {
  it("un saludo ('Hola'/'buenas') se trata como asentimiento, no como ruido", () => {
    expect(classifyCallSignal({ utterance: "Hola" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "buenas" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "hola qué tal" })).toBe("follows-along");
  });

  it("'¿quién eres?' / '¿de qué agencia?' -> asks-identity (NO defiere a mi socio)", () => {
    expect(classifyCallSignal({ utterance: "¿quién eres?" })).toBe("asks-identity");
    expect(classifyCallSignal({ utterance: "sí, pero quién eres" })).toBe("asks-identity");
    expect(classifyCallSignal({ utterance: "¿de qué agencia me llamas?" })).toBe("asks-identity");
    expect(classifyCallSignal({ utterance: "¿de dónde llamas?" })).toBe("asks-identity");
  });

  it("'el 30% es poco' -> queja del reparto (presenta/negocia, no pide repetir)", () => {
    expect(classifyCallSignal({ utterance: "el 30% es poco" })).toBe("complains-about-share");
  });

  it("'sigue siendo poco' en negociación -> queja del reparto (mantiene la escalera)", () => {
    expect(classifyCallSignal({ utterance: "sigue siendo poco", moneyContext: true })).toBe("complains-about-share");
  });

  it("'¿cómo abro la cuenta de OnlyFans?' es PREGUNTA (la palabra 'cuenta' ya no lo confunde con 'continúa')", () => {
    expect(classifyCallSignal({ utterance: "¿y cómo abro la cuenta de OnlyFans?", isCoveredQuestion: true })).toBe(
      "asks-covered"
    );
    expect(classifyCallSignal({ utterance: "¿cómo abro la cuenta de OnlyFans?" })).toBe("asks-unknown");
  });

  it("'cuéntame' sigue siendo asentimiento (no se rompió al arreglar 'cuenta')", () => {
    expect(classifyCallSignal({ utterance: "cuéntame" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "vale, cuéntame" })).toBe("follows-along");
  });
});

describe("director + redacción: identidad", () => {
  it("asks-identity (tras la apertura) -> GIVE_IDENTITY", () => {
    const afterDisclosure = { ...initialCallDirectorState(), disclosureGiven: true };
    const decision = decideCallDirective({ state: afterDisclosure, signal: "asks-identity" });
    expect(decision.directive.type).toBe("GIVE_IDENTITY");
  });

  it("GIVE_IDENTITY dice quién es (Alex de Rose Models) de forma determinista", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_IDENTITY" } });
    expect(plan.deterministicText).toBe(plan.fallbackText);
    expect(plan.deterministicText?.toLowerCase()).toContain("soy alex");
    expect(plan.deterministicText?.toLowerCase()).toContain("rose models");
    expect(plan.deterministicText).not.toContain("mi socio");
  });
});
