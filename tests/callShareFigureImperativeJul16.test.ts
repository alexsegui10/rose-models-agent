import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";

const sig = (utterance: string, moneyContext?: boolean, isCoveredQuestion?: boolean) =>
  classifyCallSignal({ utterance, moneyContext, isCoveredQuestion });

// Barrido de voz 16-jul (nº1, EL GORDO — persona regateadora): el bot bajaba bien la escalera y cedía el
// 40% para ella ("de ahí no bajamos"), pero cuando ella volvía a pedir la cifra con una ORDEN ("decime bien
// el porcentaje"), el clasificador no la reconocía (solo captaba la forma pregunta "¿cuánto os lleváis?"),
// caía a asks-covered -> ANSWER_FROM_KNOWLEDGE -> recitaba el 70/30 ENLATADO, contradiciéndose. Ella lo
// cazaba ("recién me dijiste 40, no me cambies"). Regla de Alex: siempre a MÁS, nunca a menos — al re-pedir
// la cifra, se repite el escalón vigente (40), jamás uno peor.
describe("pedir la cifra del reparto en IMPERATIVO se trata como la pregunta (nº1, barrido voz 16-jul)", () => {
  it("órdenes de pedir la cifra -> asks-share-figure (no asks-covered que recitaría el 70/30)", () => {
    expect(sig("decime bien el porcentaje")).toBe("asks-share-figure");
    expect(sig("decime bien lo del porcentaje porque para mí eso es clave")).toBe("asks-share-figure");
    expect(sig("explicame el reparto")).toBe("asks-share-figure");
    expect(sig("repetime el porcentaje")).toBe("asks-share-figure");
    expect(sig("aclarame la comisión")).toBe("asks-share-figure");
    expect(sig("pasame el porcentaje")).toBe("asks-share-figure");
    expect(sig("contame otra vez la cifra del reparto")).toBe("asks-share-figure");
  });

  it("la forma PREGUNTA sigue funcionando igual (regresión)", () => {
    expect(sig("¿cuánto os lleváis?")).toBe("asks-share-figure");
    expect(sig("¿qué porcentaje es?")).toBe("asks-share-figure");
  });

  it("una QUEJA del reparto sigue siendo queja (negocia), NO se trata como pedir la cifra", () => {
    expect(sig("el porcentaje me parece muy poco", true)).toBe("complains-about-share");
    expect(sig("bajame la comisión", true)).toBe("complains-about-share");
    // "dame más" es pedir MÁS (queja), NO pedir oír la cifra: el fix (que a propósito NO incluye "dame")
    // jamás lo convierte en asks-share-figure (que repetiría la cifra en vez de negociar).
    expect(sig("dame más porcentaje", true)).not.toBe("asks-share-figure");
  });

  it("una orden SIN referencia a la cifra no se confunde con pedir el reparto", () => {
    expect(sig("decime bien cómo funciona esto")).not.toBe("asks-share-figure");
    expect(sig("explicame qué tengo que hacer yo")).not.toBe("asks-share-figure");
  });

  it("si el reparto está NEGADO o DESESTIMADO, NO se presenta la cifra (no roba su pregunta real)", () => {
    // Revisor 16-jul: sin el guard de negación, estas robaban la pregunta real presentando el %.
    expect(sig("dime, el reparto no me importa, cómo empiezo")).not.toBe("asks-share-figure");
    expect(sig("explicame, no el reparto sino cómo grabo")).not.toBe("asks-share-figure");
    expect(sig("explicame otra cosa, no el reparto")).not.toBe("asks-share-figure");
    expect(sig("contame del reparto de tareas del equipo")).not.toBe("asks-share-figure");
    // Pero un "no" que NO niega la cifra no bloquea la petición legítima:
    expect(sig("no me acuerdo, repetime el porcentaje")).toBe("asks-share-figure");
  });

  // ─── El escenario EXACTO del bug, de punta a punta: cedido el 40, re-pregunta -> repite 40, NO 30 ────
  it("cedido el 40%, al re-pedir la cifra el director da 40 (no revierte al 30) — 'nunca a menos'", () => {
    // Estado: ya se presentó el dinero y se cedió hasta el suelo (escalón 2 = 40% para ella / 60% agencia).
    const state: CallDirectorState = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS", "MONEY"],
      revenueShareStep: 2,
      shareDefended: true
    };
    // Ella vuelve a pedir la cifra con una orden, en pleno contexto de dinero.
    const signal = classifyCallSignal({ utterance: "pará, decime bien el porcentaje", moneyContext: true });
    expect(signal).toBe("asks-share-figure");
    const decision = decideCallDirective({ state, signal });
    expect(decision.directive.type).toBe("GIVE_SHARE_FIGURE");
    // La cifra que se re-dice es el escalón vigente: 40% para ella, 60% agencia — NUNCA el 30/70 enlatado.
    expect(decision.directive.shareOffer?.modelShare).toBe(40);
    expect(decision.directive.shareOffer?.agencyShare).toBe(60);
  });
});
