import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";

const sig = (utterance: string, isCoveredQuestion?: boolean) => classifyCallSignal({ utterance, isCoveredQuestion });

// Barrido de voz 16-jul (nº7), CONFIRMADO en vivo: "¿tengo que pagar impuestos yo por eso?" -> el bot
// respondía "con nosotros no pagas nada por entrar ni por probar" (las CUOTAS de la agencia), un sinsentido:
// no contesta lo que pregunta. Causa: el recuperador daba la pregunta por "cubierta" con la entrada de pagos.
//
// CRITERIO DE ALEX (16-jul): los impuestos son cosa de ELLA (OnlyFans le paga a su cuenta y desde ahí nos
// paga a nosotros) y estas preguntas casi no salen -> el bot NO habla de impuestos, se lo pasa a Alex.
// A propósito SIMPLE: se reconoce el tema y se defiere; no se persiguen fraseos exóticos.

describe("nº7 impuestos: el bot no los responde, se los pasa a Alex (criterio de Alex 16-jul)", () => {
  it("una pregunta de impuestos se defiere, aunque el recuperador la crea cubierta", () => {
    // isCoveredQuestion=true es justo el caso del bug: el recuperador decía "cubierta" y respondía cuotas.
    expect(sig("tengo que pagar impuestos yo por eso o cómo es?", true)).toBe("asks-unknown");
    expect(sig("y los impuestos cómo van?", true)).toBe("asks-unknown");
    expect(sig("tengo que estar en monotributo?", true)).toBe("asks-unknown");
    expect(sig("hay que declarar esto en la AFIP?", true)).toBe("asks-unknown");
    expect(sig("esto hay que declararlo?", true)).toBe("asks-unknown");
  });

  it("el director convierte ese defer en 'se lo paso a mi socio', no en una respuesta inventada", () => {
    const state: CallDirectorState = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS"]
    };
    const signal = classifyCallSignal({ utterance: "tengo que pagar impuestos yo?", isCoveredQuestion: true });
    expect(decideCallDirective({ state, signal }).directive.type).toBe("DEFER_TO_PARTNER");
  });

  it("NO se traga otras preguntas cubiertas (solo impuestos se defiere)", () => {
    expect(sig("cuántas chicas llevan?", true)).toBe("asks-covered");
    expect(sig("tengo que pagar algo para entrar?", true)).toBe("asks-covered");
    expect(sig("cuándo cobro?", true)).toBe("asks-covered");
  });

  // Lo que importa DE VERDAD aquí: la puerta fiscal va DESPUÉS de la cifra del reparto, así que no puede
  // evadir una pregunta legítima de la cifra ni reabrir el nº1 (recitar el 70/30 con una concesión viva).
  // Una versión anterior de este fix SÍ lo reabría; la suite verde no lo veía y lo cazó el revisor.
  it("REGRESIÓN nº1: nombrar impuestos NO evade la cifra ni revierte una concesión (40 sigue siendo 40)", () => {
    const state: CallDirectorState = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS", "MONEY"],
      revenueShareStep: 2, // ya se cedió el 40% para ella
      shareDefended: true
    };
    const signal = classifyCallSignal({
      utterance: "decime el porcentaje, que después el estado me saca lo suyo",
      moneyContext: true,
      isCoveredQuestion: true
    });
    expect(signal).toBe("asks-share-figure");
    const decision = decideCallDirective({ state, signal });
    expect(decision.directive.type).toBe("GIVE_SHARE_FIGURE");
    expect(decision.directive.shareOffer?.modelShare).toBe(40);
  });

  it("nombrar impuestos de pasada NO evade la cifra del reparto (invariante 3 reactivo)", () => {
    expect(sig("cuánto os lleváis después de impuestos?", true)).toBe("asks-share-figure");
    expect(sig("cuánto os lleváis vosotros y cuánto hacienda?", true)).toBe("asks-share-figure");
    expect(sig("repetime el reparto, que tengo que ver lo del IRPF", true)).toBe("asks-share-figure");
  });

  it("no roba preguntas legítimas: 'iva' del STT por 'iba', y el color negro no es dinero en negro", () => {
    expect(sig("yo iva a preguntarte si tengo que pagar algo para entrar", true)).not.toBe("asks-unknown");
    expect(sig("las fotos las hago en negro o en rojo?", true)).not.toBe("asks-unknown");
    expect(sig("cuánto se factura al mes con esto?", true)).not.toBe("asks-unknown");
  });
});
