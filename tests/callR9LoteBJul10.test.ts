import { describe, it, expect } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";

// Lote B del sweep R9 (10-jul): fixes ADYACENTES AL INVARIANTE 3 (deteccion de la pregunta/queja del
// reparto y flujo del cierre), con bateria adversarial: un falso positivo aqui regala un escalon o suelta
// la cifra sin que la pidan; un falso negativo defiere la cifra pedida (evasivo). Decisiones ya de Alex:
// la cifra es REACTIVA (preguntada, se dice) y la escalera 70->65->60 solo ante queja REAL.

const sig = (utterance: string, extra: Parameters<typeof classifyCallSignal>[0] = { utterance }) =>
  classifyCallSignal({ ...extra, utterance });

describe("B1. '¿cuanto cobrais (vosotros)?' pregunta LA CIFRA -> asks-share-figure (reactivo, no defer)", () => {
  for (const phrase of [
    "espera espera, primero: cuanto cobrais vosotros?",
    "cuanto cobrais?",
    "y ustedes cuanto cobran?",
    "tu cuanto cobras de esto?"
  ]) {
    it(`"${phrase}" -> asks-share-figure`, () => {
      expect(sig(phrase)).toBe("asks-share-figure");
    });
  }

  it("'cuanto cobro yo' / 'cuanto voy a cobrar' SIGUE siendo ingresos (sin cifra)", () => {
    expect(sig("y yo cuanto cobro al mes?")).toBe("asks-earnings");
    expect(sig("cuanto voy a cobrar?")).toBe("asks-earnings");
  });
});

describe("B2. '¿y el reparto?' pelado -> asks-share-figure (presenta MONEY y lo deja CUBIERTO)", () => {
  for (const phrase of ["y el reparto?", "y el porcentaje?", "¿y la comision?"]) {
    it(`"${phrase}" -> asks-share-figure`, () => {
      expect(sig(phrase)).toBe("asks-share-figure");
    });
  }

  it("directors: responder la cifra pedida deja MONEY cubierta -> moneyContext para la negociacion", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const d = decideCallDirective({ state: opened, signal: "asks-share-figure" });
    expect(d.directive.type).toBe("COVER_STAGE");
    expect(d.directive.stageId).toBe("MONEY");
    expect(d.nextState.coveredStages).toContain("MONEY");
  });

  it("'el reparto es injusto' SIGUE siendo queja (no pregunta)", () => {
    expect(sig("el reparto es injusto eh")).toBe("complains-about-share");
  });
});

describe("B3. 'cara' (rostro) ya NO cuenta como 'caro' (queja de precio) — bug 'la cara la decides tu'", () => {
  it("'vale 70/30 ok, y la cara que?' NO es queja de reparto (es pregunta de la cara)", () => {
    expect(sig("vale 70/30 ok, y la cara que?")).not.toBe("complains-about-share");
  });

  it("con cobertura, 'y la cara que?' se responde con conocimiento (asks-covered)", () => {
    expect(sig("vale 70/30 ok, y la cara que?", { utterance: "x", isCoveredQuestion: true })).toBe("asks-covered");
  });

  for (const phrase of ["el 70 me sale caro", "eso del 70 es muy caro", "me parece caro el reparto"]) {
    it(`"${phrase}" SIGUE siendo queja (caro = precio)`, () => {
      expect(sig(phrase, { utterance: phrase, moneyContext: true })).toBe("complains-about-share");
    });
  }

  it("'mi cara' / 'la cara' + terminos de reparto NO dispara queja por el homografo", () => {
    expect(sig("con el 70/30 vale, pero mi cara sale en todo?")).not.toBe("complains-about-share");
  });
});

describe("B4. 'no me podeis mejorar eso un poco?' EN NEGOCIACION -> escalera (no defer con 'uf ojala')", () => {
  for (const phrase of [
    "uf, y no me podeis mejorar eso un poco?",
    "no me lo podeis mejorar?",
    "podeis mejorar el porcentaje?",
    "y si me mejoras la oferta?"
  ]) {
    it(`"${phrase}" (moneyContext) -> complains-about-share`, () => {
      expect(sig(phrase, { utterance: phrase, moneyContext: true })).toBe("complains-about-share");
    });
  }

  it("ADVERSARIAL: 'mejorar' NO-dinero no regala escalon", () => {
    // "mejorar las fotos" en moneyContext: NO es queja del reparto.
    expect(sig("puedo mejorar las fotos con el tiempo?", { utterance: "x", moneyContext: true })).not.toBe(
      "complains-about-share"
    );
    // Sin moneyContext, "mejorar eso" tampoco (podria ser cualquier cosa).
    expect(sig("no me podeis mejorar eso un poco?")).not.toBe("complains-about-share");
  });

  it("BLOQUEANTE B-1 del revisor: un COMPROMISO de ELLA de mejorar JAMAS es queja (no regala 65)", () => {
    for (const phrase of [
      "se que tengo que mejorar",
      "voy a mejorar",
      "prometo mejorar",
      "quiero mejorar?",
      "vale, voy a mejorar eso",
      "voy a mejorar eso que dijiste de las fotos"
    ]) {
      expect(sig(phrase, { utterance: phrase, moneyContext: true }), phrase).not.toBe("complains-about-share");
    }
  });

  it("R-1 del revisor: 'con esta cara puedo cobrar el 70?' NO es queja (homografo con 'esta')", () => {
    expect(sig("con esta cara puedo cobrar el 70?")).not.toBe("complains-about-share");
    expect(sig("vuestra cara me suena, y el 70 que?")).not.toBe("complains-about-share");
  });

  it("N-1 del revisor: el PLURAL 'caras' sigue contando como queja de precio", () => {
    expect(sig("vuestras condiciones del 70 son caras", { utterance: "x", moneyContext: true })).toBe("complains-about-share");
  });

  it("N-2 del revisor: 'cuanto cobran LAS modelos/chicas' NO es la cifra de la agencia", () => {
    expect(sig("cuanto cobran las modelos?")).not.toBe("asks-share-figure");
    expect(sig("y cuanto cobran las que empiezan?")).not.toBe("asks-share-figure");
    // Pero la 3ª persona hacia la AGENCIA sigue siendo la cifra:
    expect(sig("y ustedes cuanto cobran?")).toBe("asks-share-figure");
  });

  it("flujo completo: cifra pedida -> queja 'mejorar' -> DEFIENDE el 70 (no regala 65 a la primera)", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const money = decideCallDirective({ state: opened, signal: "asks-share-figure" }).nextState;
    const complaint = decideCallDirective({ state: money, signal: "complains-about-share" });
    expect(complaint.directive.type).toBe("DEFEND_SHARE");
    // Segunda queja: ahora si, 65 (escalera integra).
    const second = decideCallDirective({ state: complaint.nextState, signal: "complains-about-share" });
    expect(second.directive.type).toBe("CONCEDE_SHARE");
    expect(second.directive.shareOffer?.modelShare).toBe(35);
  });
});

describe("B5. El cierre NO se repite tras un asentimiento puro ('dale') — silencio", () => {
  function closedState(): CallDirectorState {
    let state = initialCallDirectorState();
    for (let i = 0; i < 8 && !state.closed; i++) {
      state = decideCallDirective({ state, signal: "follows-along" }).nextState;
    }
    expect(state.closed).toBe(true);
    return state;
  }

  it("closed + follows-along ('dale') -> STAY_SILENT (no re-suelta el contrato)", () => {
    const state = closedState();
    expect(decideCallDirective({ state, signal: "follows-along" }).directive.type).toBe("STAY_SILENT");
  });

  it("closed + unclear (no oyo bien) -> SI repite el cierre una vez (eso se conserva)", () => {
    const state = closedState();
    const first = decideCallDirective({ state, signal: "unclear" });
    expect(first.directive.type).toBe("CLOSE_WITH_CONTRACT");
    const second = decideCallDirective({ state: first.nextState, signal: "unclear" });
    expect(second.directive.type).toBe("STAY_SILENT");
  });

  it("SEGURIDAD tras cerrar intacta: pregunta se responde, hostil escala, despedida despide", () => {
    const state = closedState();
    expect(decideCallDirective({ state, signal: "asks-covered" }).directive.type).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(decideCallDirective({ state, signal: "hostile-or-suspicious" }).directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decideCallDirective({ state, signal: "wants-to-end" }).directive.type).toBe("SAY_GOODBYE");
  });
});
