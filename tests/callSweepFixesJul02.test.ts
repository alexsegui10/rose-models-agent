import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// Fixes del BARRIDO de personas (2-jul, con el redactor OpenAI real): 6 defectos de calidad que la
// suite no cubría. Cada bloque referencia el defecto observado en la transcripción.

describe("F1: coletillas y saludos antes del sí ('hola si' ya no acaba en '¿me lo repites?')", () => {
  for (const phrase of ["hola si", "hola si soy yo", "mmm vale...", "eh bueno dale", "si? hola si", "buenas, si dime"]) {
    it(`"${phrase}" -> follows-along`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("follows-along");
    });
  }
  it("'con ella habla' (LATAM) -> follows-along; pero 'lo hablo con ella' NO (es consultar a alguien)", () => {
    expect(classifyCallSignal({ utterance: "alo si, con ella habla" })).toBe("follows-along");
    expect(classifyCallSignal({ utterance: "lo tengo que hablar con ella" })).not.toBe("follows-along");
  });
});

describe("F2: el LLM no puede despedirse en turnos intermedios (despedida improvisada -> fallback)", () => {
  it("'no podemos trabajar contigo...un saludo' es INVÁLIDO como draft (allowFarewell false)", () => {
    const result = validateCallUtterance(
      "Entiendo, pero es nuestra manera de trabajar, así que no podemos trabajar contigo; espero que te vaya genial, un saludo.",
      undefined,
      { allowFarewell: false }
    );
    expect(result.valid).toBe(false);
  });
  it("una respuesta normal sigue siendo válida con allowFarewell false", () => {
    expect(
      validateCallUtterance("Mira, la cara se necesita para el contenido, es parte del método. ¿Te encaja?", undefined, {
        allowFarewell: false
      }).valid
    ).toBe(true);
  });
  it("los cierres deterministas legítimos NO se ven afectados (allowFarewell por defecto)", () => {
    expect(validateCallUtterance("Gracias por tu tiempo y un saludo.").valid).toBe(true);
  });
});

describe("F3 (invariante 3, adversarial): preguntar la CIFRA del reparto la responde, jamás la defiere", () => {
  for (const phrase of [
    "¿cuanto os llevais vosotros?",
    "¿me repites cuanto te llevas tu?",
    "¿el reparto como era?",
    "¿que porcentaje os quedais?",
    "¿cual es la comision?"
  ]) {
    it(`"${phrase}" -> asks-share-figure`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("asks-share-figure");
    });
  }

  it("las QUEJAS siguen siendo quejas (no se confunden con la pregunta de la cifra)", () => {
    expect(classifyCallSignal({ utterance: "¿por que os llevais el 70?" })).toBe("complains-about-share");
    expect(classifyCallSignal({ utterance: "os llevais mucho vosotros" })).toBe("complains-about-share");
    expect(classifyCallSignal({ utterance: "quiero mas para mi, el 50 y 50" })).toBe("complains-about-share");
  });

  it("'¿cuanto ganaria yo?' sigue siendo earnings (honesta sin cifras), no la cifra del reparto", () => {
    expect(classifyCallSignal({ utterance: "¿cuanto ganaria yo al mes?" })).toBe("asks-earnings");
  });

  it("director: preguntada ANTES de MONEY -> presenta el 70/30 (cuenta como etapa cubierta)", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const decision = decideCallDirective({ state: opened, signal: "asks-share-figure" });
    expect(decision.directive.type).toBe("COVER_STAGE");
    expect(decision.directive.stageId).toBe("MONEY");
    expect(decision.directive.shareOffer?.agencyShare).toBe(70);
    expect(decision.nextState.coveredStages).toContain("MONEY");
  });

  it("director: preguntada DESPUÉS de MONEY -> GIVE_SHARE_FIGURE con la cifra vigente, sin mover la negociación", () => {
    let state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    state = decideCallDirective({ state, signal: "asks-share-figure" }).nextState; // cubre MONEY
    const again = decideCallDirective({ state, signal: "asks-share-figure" });
    expect(again.directive.type).toBe("GIVE_SHARE_FIGURE");
    expect(again.directive.shareOffer?.modelShare).toBe(30);
    expect(again.nextState.revenueShareStep).toBe(state.revenueShareStep);
  });

  it("director: en MITAD de la negociación (65/35 vigente) responde el escalón vigente, no regala otro", () => {
    let state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    state = decideCallDirective({ state, signal: "asks-share-figure" }).nextState; // 70/30 presentado
    state = decideCallDirective({ state, signal: "complains-about-share" }).nextState; // defiende
    state = decideCallDirective({ state, signal: "complains-about-share" }).nextState; // concede 65/35
    const ask = decideCallDirective({ state, signal: "asks-share-figure" });
    expect(ask.directive.type).toBe("GIVE_SHARE_FIGURE");
    expect(ask.directive.shareOffer?.modelShare).toBe(35);
    expect(ask.directive.shareOffer?.agencyShare).toBe(65);
    expect(ask.nextState.revenueShareStep).toBe(state.revenueShareStep);
  });

  it("redacción: GIVE_SHARE_FIGURE dice la cifra EXACTA autorizada, determinista", () => {
    const plan = planCallUtterance({
      directive: { type: "GIVE_SHARE_FIGURE", shareOffer: { modelShare: 30, agencyShare: 70, step: 0, isFloor: false } }
    });
    expect(plan.deterministicText).toContain("30% para ti");
    expect(plan.deterministicText).toContain("70% para la agencia");
    expect(plan.draftingBrief).toBeUndefined();
  });

  it("responder E2E: '¿cuanto os llevais?' al principio -> responde con el 70/30, no 'te lo mando por WhatsApp'", async () => {
    const res = await respondToCall({
      messages: [
        { role: "system", content: "p" },
        { role: "assistant", content: "apertura..." },
        { role: "user", content: "¿cuanto os llevais vosotros?" }
      ]
    });
    expect(res.content).toContain("70");
    expect(res.content).toContain("30");
    expect(res.content.toLowerCase()).not.toContain("whatsapp");
  });

  it("tras el cierre: preguntar la cifra la re-dice (no silencio, no repetir el contrato)", () => {
    let state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    for (let i = 0; i < 12 && !state.closed; i++) {
      state = decideCallDirective({ state, signal: "follows-along" }).nextState;
    }
    const ask = decideCallDirective({ state, signal: "asks-share-figure" });
    expect(ask.directive.type).toBe("GIVE_SHARE_FIGURE");
    expect(ask.nextState.closed).toBe(true);
  });

  it("SEGURIDAD: tras el corte por MENOR, preguntar la cifra NO la recibe (repite el corte)", () => {
    const cut = decideCallDirective({ state: initialCallDirectorState(), signal: "underage" }).nextState;
    const ask = decideCallDirective({ state: cut, signal: "asks-share-figure" });
    expect(ask.directive.type).toBe("CLOSE_UNDERAGE");
  });
});

describe("F4: '¿eres un robot?' -> identidad sin mentir", () => {
  for (const phrase of ["¿eres un robot o una persona?", "¿hablo con una maquina?", "eres una ia, ¿no?", "¿sos un bot?"]) {
    it(`"${phrase}" -> asks-identity`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("asks-identity");
    });
  }
  it("'no quiero hablar con un robot' sigue siendo wants-human (rechazo, no pregunta)", () => {
    expect(classifyCallSignal({ utterance: "no quiero hablar con un robot" })).toBe("wants-human");
  });
  it("el validador rechaza 'Soy una persona, tranquila' en cualquier draft", () => {
    expect(validateCallUtterance("Soy una persona, tranquila. Seguimos, ¿te va?").valid).toBe(false);
    expect(validateCallUtterance("Que no, que no soy un robot, jaja.").valid).toBe(false);
  });
  it("el brief de identidad prohíbe afirmar humanidad", () => {
    const plan = planCallUtterance({ directive: { type: "GIVE_IDENTITY" } });
    expect(plan.draftingBrief!.prohibitedClaims.join(" ")).toContain("IA");
  });
});

describe("F5: tras la despedida, las coletillas callan ('chau chau' ya no re-suelta el cierre)", () => {
  it("'chau chau' -> wants-to-end", () => {
    expect(classifyCallSignal({ utterance: "chau chau" })).toBe("wants-to-end");
  });
  it("director: goodbye dado -> follows-along/none/chau -> STAY_SILENT (nunca el discurso del contrato)", () => {
    let state: CallDirectorState = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    for (let i = 0; i < 12 && !state.closed; i++) {
      state = decideCallDirective({ state, signal: "follows-along" }).nextState;
    }
    const bye = decideCallDirective({ state, signal: "wants-to-end" });
    expect(bye.directive.type).toBe("SAY_GOODBYE");
    for (const signal of ["follows-along", "none", "wants-to-end"] as const) {
      expect(decideCallDirective({ state: bye.nextState, signal }).directive.type).toBe("STAY_SILENT");
    }
  });
});

describe("F6: 'perdona, ¿que decias?' -> repetir lo último dicho (no deferir, no pedirle que repita ELLA)", () => {
  for (const phrase of ["perdona se corta, ¿que decias?", "no te escuche bien", "¿me lo repites?", "¿como?"]) {
    it(`"${phrase}" -> asks-bot-to-repeat`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("asks-bot-to-repeat");
    });
  }

  it("responder E2E: repite el último enunciado del bot tal cual", async () => {
    const res = await respondToCall({
      messages: [
        { role: "system", content: "p" },
        { role: "assistant", content: "apertura..." },
        { role: "user", content: "si dime" },
        { role: "assistant", content: "Nosotros nos encargamos del tráfico y la gestión, tú solo mandas el contenido." },
        { role: "user", content: "perdona se corta, ¿que decias?" }
      ]
    });
    expect(res.directiveType).toBe("REPEAT_LAST_UTTERANCE");
    expect(res.content).toContain("Nosotros nos encargamos del tráfico");
    expect(res.content.toLowerCase()).not.toContain("whatsapp");
  });

  it("no avanza la agenda: el estado queda igual (replay consistente)", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const repeat = decideCallDirective({ state: opened, signal: "asks-bot-to-repeat" });
    expect(repeat.nextState.coveredStages).toEqual(opened.coveredStages);
  });

  it("SIN anidamiento: repetir dos veces no produce 'Sí, te decía: Sí, te decía:' (riesgo del revisor)", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: "Sí, te decía: Nosotros nos encargamos del tráfico."
    });
    expect(plan.deterministicText).toBe("Sí, te decía: Nosotros nos encargamos del tráfico.");
    expect(plan.deterministicText).not.toContain("Sí, te decía: Sí, te decía:");
  });

  it("el eco se RE-VALIDA: un transcript con contenido no autorizado no se repite (fuente externa)", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: "El reparto es un 80% para ti, te lo prometo."
    });
    expect(plan.deterministicText).not.toContain("80");
    expect(plan.deterministicText!.length).toBeGreaterThan(0);
  });

  it("3 '¿qué decías?' consecutivos -> handoff por audio roto (no bucle infinito de repeticiones)", () => {
    let state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const first = decideCallDirective({ state, signal: "asks-bot-to-repeat" });
    expect(first.directive.type).toBe("REPEAT_LAST_UTTERANCE");
    const second = decideCallDirective({ state: first.nextState, signal: "asks-bot-to-repeat" });
    expect(second.directive.type).toBe("REPEAT_LAST_UTTERANCE");
    const third = decideCallDirective({ state: second.nextState, signal: "asks-bot-to-repeat" });
    expect(third.directive.type).toBe("HANDOFF_TO_ALEX");
    expect(third.directive.handoffReason).toBe("audio-unintelligible");
    // Y una señal entendida entre medias reinicia la racha (no acumula no-consecutivos).
    const back = decideCallDirective({ state: second.nextState, signal: "follows-along" });
    expect(back.nextState.repeatRequestStreak).toBe(0);
  });

  it("validador: 'soy un humano' / 'no soy ningún robot' / 'soy real' también se rechazan (huecos)", () => {
    expect(validateCallUtterance("Que va, soy un humano normal, jaja.").valid).toBe(false);
    expect(validateCallUtterance("No soy ningun robot, de verdad.").valid).toBe(false);
    expect(validateCallUtterance("Soy real, de verdad, seguimos?").valid).toBe(false);
  });
});
