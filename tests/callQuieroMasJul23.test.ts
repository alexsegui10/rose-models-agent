import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";

// 1ª LLAMADA REAL (Alba, 21-jul) — el peor error: tras presentar el 30/70 ella dijo "el 70 es demasiado"
// (DEFEND arrancó y ELLA le cortó) y luego "Quiero más." / "Te quiero más." → el oído no lo tenía como queja
// → "no te pillo, ¿me lo repites?" (fingiendo sordera a quien LE cortó) y después la comprensión lo leyó como
// cariño → "qué maja, Alba" → cerró con la negociación ABANDONADA. En moneyContext, "quiero más" es una
// continuación de negociación INEQUÍVOCA y debe ser determinista (invariante 1: el % lo lleva el código).

describe("'quiero más' en contexto de dinero = queja del reparto (llamada real de Alba)", () => {
  it("en moneyContext: 'quiero más' y variantes → complains-about-share", () => {
    for (const u of ["quiero más", "quiero mas", "te quiero más", "que quiero más", "yo quiero más, dale"]) {
      expect(classifyCallSignal({ utterance: u, moneyContext: true }), u).toBe("complains-about-share");
    }
  });

  it("la escalera responde: tras defender, 'quiero más' concede el escalón AUTORIZADO (35), jamás otra cifra", () => {
    const state = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS" as const, "MONEY" as const],
      shareDefended: true
    };
    const d = decideCallDirective({ state, signal: "complains-about-share" });
    expect(d.directive.type).toBe("CONCEDE_SHARE");
    if (d.directive.type === "CONCEDE_SHARE") {
      expect(d.directive.shareOffer?.modelShare).toBe(35);
      expect(d.directive.shareOffer?.agencyShare).toBe(65);
    }
  });

  it("SIN moneyContext no dispara (no regala escalones fuera de la negociación)", () => {
    expect(classifyCallSignal({ utterance: "quiero más" })).not.toBe("complains-about-share");
  });

  it("'quiero más información/fotos/tiempo' NO es queja del reparto ni en moneyContext", () => {
    for (const u of ["quiero más información", "quiero más detalles", "quiero más tiempo para pensarlo"]) {
      expect(classifyCallSignal({ utterance: u, moneyContext: true }), u).not.toBe("complains-about-share");
    }
  });

  // Revisor 23-jul (RIESGO 2): un RECHAZO con "no quiero más" disparaba la negociación y regalaba un escalón.
  it("la NEGACIÓN no negocia: 'no (te) quiero más' y 'quiero más que nada...' NO son queja", () => {
    // Lo que se GARANTIZA: jamás cuentan como queja del reparto (no regalan escalón). El destino fino
    // ("no, gracias" → not-interested o → comprensión IA) lo resuelve el resto del pipeline.
    for (const u of [
      "no, no quiero más, gracias",
      "no quiero más vueltas, déjalo",
      "quiero más que nada saber cómo funciona",
      "ya no quiero más"
    ]) {
      expect(classifyCallSignal({ utterance: u, moneyContext: true }), u).not.toBe("complains-about-share");
    }
  });
});

describe("'¿cuánto me vais a pagar?' pre-MONEY presenta el reparto AHÍ (no esquiva y vuelve al guion)", () => {
  it("asks-earnings con MONEY sin cubrir → COVER_STAGE MONEY con la oferta inicial 30/70", () => {
    const state = { ...initialCallDirectorState(), disclosureGiven: true, coveredStages: ["HOW_AGENCY_WORKS" as const] };
    const d = decideCallDirective({ state, signal: "asks-earnings" });
    expect(d.directive.type).toBe("COVER_STAGE");
    if (d.directive.type === "COVER_STAGE") {
      expect(d.directive.stageId).toBe("MONEY");
      expect(d.directive.shareOffer?.modelShare).toBe(30);
      expect(d.directive.shareOffer?.agencyShare).toBe(70);
    }
    expect(d.nextState.coveredStages).toContain("MONEY");
  });

  it("con MONEY YA cubierto → GIVE_EARNINGS honesto (sin cifras), como siempre", () => {
    const state = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      coveredStages: ["HOW_AGENCY_WORKS" as const, "MONEY" as const]
    };
    const d = decideCallDirective({ state, signal: "asks-earnings" });
    expect(d.directive.type).toBe("GIVE_EARNINGS");
  });

  it("tras un CIERRE no reabre el guion: asks-earnings sigue en GIVE_EARNINGS (cierre pegajoso)", () => {
    const state = {
      ...initialCallDirectorState(),
      disclosureGiven: true,
      closed: true,
      closeDirective: "CLOSE_WITH_CONTRACT" as const,
      coveredStages: ["HOW_AGENCY_WORKS" as const]
    };
    const d = decideCallDirective({ state, signal: "asks-earnings" });
    expect(d.directive.type).toBe("GIVE_EARNINGS");
    expect(d.nextState.coveredStages).not.toContain("MONEY");
  });
});
