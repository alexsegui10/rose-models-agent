import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

const sig = (utterance: string, isCoveredQuestion?: boolean) => classifyCallSignal({ utterance, isCoveredQuestion });

describe("clasificador de señal de la llamada", () => {
  it("agresión / acusación directa -> hostile-or-suspicious", () => {
    expect(sig("esto es una estafa, sois unos ladrones")).toBe("hostile-or-suspicious");
    expect(sig("eres imbécil")).toBe("hostile-or-suspicious");
  });

  it("pide hablar con una persona -> wants-human", () => {
    expect(sig("quiero hablar con una persona")).toBe("wants-human");
    expect(sig("prefiero no hablar con un bot")).toBe("wants-human");
    expect(sig("¿me pasas con Alex?")).toBe("wants-human");
  });

  it("queja del reparto (término de % + término de queja) -> complains-about-share", () => {
    expect(sig("el 30% es mucho")).toBe("complains-about-share");
    expect(sig("¿no podéis bajar la comisión?")).toBe("complains-about-share");
    expect(sig("os quedáis demasiado")).toBe("complains-about-share");
  });

  it("desconfianza leve (worried) -> distrust, no hostil", () => {
    expect(sig("¿cómo sé que esto es real?")).toBe("distrust");
    expect(sig("no me fío")).toBe("distrust");
    expect(sig("¿no será una estafa?")).toBe("distrust");
    expect(sig("me da un poco de miedo")).toBe("distrust");
  });

  it("quiere terminar -> wants-to-end", () => {
    expect(sig("te dejo que tengo prisa")).toBe("wants-to-end");
    expect(sig("ahora no puedo, hablamos luego")).toBe("wants-to-end");
  });

  it("pregunta: cubierta -> asks-covered, desconocida (defecto) -> asks-unknown", () => {
    expect(sig("¿cómo funciona?", true)).toBe("asks-covered");
    expect(sig("¿cómo funciona?", false)).toBe("asks-unknown");
    // Sin pista del recuperador, una pregunta se defiere a Alex (nunca se improvisa).
    expect(sig("¿y los impuestos?")).toBe("asks-unknown");
  });

  it("asentimiento -> follows-along", () => {
    expect(sig("vale, perfecto")).toBe("follows-along");
    expect(sig("sí, cuéntame")).toBe("follows-along");
  });

  it("vacío -> none", () => {
    expect(sig("")).toBe("none");
    expect(sig("   ")).toBe("none");
  });

  it("prioridad: pedir persona gana a la queja del reparto", () => {
    expect(sig("quiero hablar con una persona sobre la comisión que es mucho")).toBe("wants-human");
  });

  it("prioridad: la desconfianza se evalúa antes que la pregunta genérica", () => {
    expect(sig("¿esto es seguro? me da miedo")).toBe("distrust");
  });
});
