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

  it("'cuéntame' sigue avanzando (asks-more desde 10-jul; no se rompió al arreglar 'cuenta')", () => {
    // asks-more = misma conducta que follows-along a media llamada (avanzar agenda); tras el cierre
    // responde el remate una vez en vez de silencio.
    expect(classifyCallSignal({ utterance: "cuéntame" })).toBe("asks-more");
    expect(classifyCallSignal({ utterance: "vale, cuéntame" })).toBe("asks-more");
  });
});

describe("director + redacción: identidad", () => {
  it("asks-identity (tras la apertura) -> GIVE_IDENTITY", () => {
    const afterDisclosure = { ...initialCallDirectorState(), disclosureGiven: true };
    const decision = decideCallDirective({ state: afterDisclosure, signal: "asks-identity" });
    expect(decision.directive.type).toBe("GIVE_IDENTITY");
  });

  // jul-2026: GIVE_IDENTITY pasa a brief natural (responde a CÓMO lo preguntó) con fallback determinista.
  // Lo importante se conserva: dice quién es (Alex de Rose Models) y JAMÁS defiere a "mi socio".
  it("GIVE_IDENTITY dice quién es (Alex de Rose Models) y nunca defiere a 'mi socio'", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_IDENTITY" }, utterance: "¿quién eres?" });
    expect(plan.fallbackText.toLowerCase()).toContain("soy alex");
    expect(plan.fallbackText.toLowerCase()).toContain("rose models");
    expect(plan.fallbackText).not.toContain("mi socio");
    expect(plan.draftingBrief?.groundingFacts.join(" ")).toContain("Alex");
    expect(plan.draftingBrief?.instruction.toLowerCase()).toContain("sin inventar");
  });
});

describe("clasificador de llamada: más gaps de la batería (jul-2026)", () => {
  it("quejas del reparto inequívocas cuentan SIN contexto de dinero", () => {
    expect(classifyCallSignal({ utterance: "mitad y mitad" })).toBe("complains-about-share");
    expect(classifyCallSignal({ utterance: "en otra agencia me dan el 50" })).toBe("complains-about-share");
  });

  it("'quiero más para mí' cuenta como queja SOLO en contexto de dinero (evita falsos positivos)", () => {
    expect(classifyCallSignal({ utterance: "quiero más para mí", moneyContext: true })).toBe("complains-about-share");
    expect(classifyCallSignal({ utterance: "me gusta más para mí gusto el contenido suave" })).not.toBe("complains-about-share");
  });

  it("preguntas de ingresos (cualquier fraseo) -> asks-earnings (no defiere)", () => {
    expect(classifyCallSignal({ utterance: "¿cuánto se gana?" })).toBe("asks-earnings");
    expect(classifyCallSignal({ utterance: "¿cuánto voy a ganar al mes?" })).toBe("asks-earnings");
    expect(classifyCallSignal({ utterance: "¿se gana bien con esto?" })).toBe("asks-earnings");
  });

  it("'paso, gracias' -> desinterés (cierre cálido), no ruido", () => {
    expect(classifyCallSignal({ utterance: "paso, gracias" })).toBe("not-interested");
  });

  it("saludo PURO es asentimiento, pero una PREGUNTA prefijada con saludo NO se traga (regresión)", () => {
    expect(classifyCallSignal({ utterance: "hola qué tal" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "buenas" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "hola buenas tardes" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "hola qué tal todo" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "buenas, y el porcentaje cuál es" })).not.toBe("follows-along");
    expect(classifyCallSignal({ utterance: "hola y cuánto se cobra" })).not.toBe("follows-along");
    expect(classifyCallSignal({ utterance: "como va el tema del dinero" })).not.toBe("follows-along");
  });

  it("GIVE_EARNINGS: lo redacta el modelo (venta) PERO sin cifras ni promesas; el fallback es el suelo honesto", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_EARNINGS" } });
    // Ahora es draftingBrief (el modelo se adapta a ella) en vez de texto fijo -> "nunca ir a menos": el brief
    // prohibe cifras/promesas y el fallback (suelo) sigue siendo el texto honesto de siempre.
    expect(plan.draftingBrief).toBeDefined();
    expect(plan.draftingBrief!.prohibitedClaims.some((c) => /cifra|cantidad|dinero|ingresos/i.test(c))).toBe(true);
    expect(plan.fallbackText.toLowerCase()).toContain("depende");
    expect(plan.fallbackText).not.toMatch(/\d/);
  });
});
