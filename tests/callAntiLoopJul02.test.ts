import { describe, expect, it } from "vitest";
import {
  decideCallDirective,
  initialCallDirectorState,
  type CallCandidateSignal,
  type CallDirectorState
} from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// Anti-loro con FRASES REALES (2-jul, cazado en simulación contra producción): tras el cierre, cada
// "dale, perfecto" repetía el discurso del contrato EN BUCLE infinito (mismo patrón que el loro de 8
// minutos, pero con habla real, que el anti-loro de ruido no cubre). Regla nueva: el cierre/handoff se
// repite UNA vez como máximo; después, silencio. Y una pregunta real tras el cierre SE RESPONDE
// (decisión de Alex: "el bot siempre contesta primero"), sin reabrir guion ni negociación.

function runSignals(signals: CallCandidateSignal[]): CallDirectorState {
  let state = initialCallDirectorState();
  for (const signal of signals) {
    state = decideCallDirective({ state, signal }).nextState;
  }
  return state;
}

function closedState(): CallDirectorState {
  // none (apertura) + follows-along hasta cerrar con contrato.
  let state = initialCallDirectorState();
  state = decideCallDirective({ state, signal: "none" }).nextState;
  for (let i = 0; i < 12 && !state.closed; i++) {
    state = decideCallDirective({ state, signal: "follows-along" }).nextState;
  }
  expect(state.closed).toBe(true);
  return state;
}

describe("director: el cierre se repite UNA vez y después silencio", () => {
  it("closed + follows-along -> repite el cierre; el segundo y siguientes -> STAY_SILENT", () => {
    const state = closedState();
    const first = decideCallDirective({ state, signal: "follows-along" });
    expect(first.directive.type).toBe("CLOSE_WITH_CONTRACT");
    const second = decideCallDirective({ state: first.nextState, signal: "follows-along" });
    expect(second.directive.type).toBe("STAY_SILENT");
    const third = decideCallDirective({ state: second.nextState, signal: "none" });
    expect(third.directive.type).toBe("STAY_SILENT");
  });

  it("el cierre cálido (CLOSE_SOFT) también se capa: una repetición y silencio", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const closed = decideCallDirective({ state: opened, signal: "not-interested" }).nextState;
    const first = decideCallDirective({ state: closed, signal: "follows-along" });
    expect(first.directive.type).toBe("CLOSE_SOFT");
    const second = decideCallDirective({ state: first.nextState, signal: "follows-along" });
    expect(second.directive.type).toBe("STAY_SILENT");
  });

  it("una PREGUNTA real tras el cierre se responde (no repite el contrato, no reabre guion)", () => {
    const state = closedState();
    expect(decideCallDirective({ state, signal: "asks-covered" }).directive.type).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(decideCallDirective({ state, signal: "asks-earnings" }).directive.type).toBe("GIVE_EARNINGS");
    expect(decideCallDirective({ state, signal: "asks-identity" }).directive.type).toBe("GIVE_IDENTITY");
    expect(decideCallDirective({ state, signal: "asks-age-policy" }).directive.type).toBe("GIVE_AGE_POLICY");
    expect(decideCallDirective({ state, signal: "distrust" }).directive.type).toBe("REASSURE");
    // Ninguna reabre el guion: closed sigue true y no gasta la repetición del cierre.
    const after = decideCallDirective({ state, signal: "asks-covered" }).nextState;
    expect(after.closed).toBe(true);
    expect(decideCallDirective({ state: after, signal: "follows-along" }).directive.type).toBe("CLOSE_WITH_CONTRACT");
  });

  it("queja del reparto tras el cierre -> DEFER (sin cifra, sin reabrir negociación) — invariante 3", () => {
    const state = closedState();
    const decision = decideCallDirective({ state, signal: "complains-about-share" });
    expect(decision.directive.type).toBe("DEFER_TO_PARTNER");
    expect(decision.directive.shareOffer).toBeUndefined();
    expect(decision.nextState.revenueShareStep).toBe(state.revenueShareStep);
    expect(decision.nextState.closed).toBe(true);
  });

  it("se despide tras el cierre -> despedida corta UNA vez, luego silencio", () => {
    const state = closedState();
    const bye = decideCallDirective({ state, signal: "wants-to-end" });
    expect(bye.directive.type).toBe("SAY_GOODBYE");
    const again = decideCallDirective({ state: bye.nextState, signal: "wants-to-end" });
    expect(again.directive.type).toBe("STAY_SILENT");
  });

  it("la SEGURIDAD sigue intacta tras el cierre: agresión y pedir persona escalan; menor corta", () => {
    const state = closedState();
    expect(decideCallDirective({ state, signal: "hostile-or-suspicious" }).directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decideCallDirective({ state, signal: "wants-human" }).directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decideCallDirective({ state, signal: "underage" }).directive.type).toBe("CLOSE_UNDERAGE");
  });
});

describe("INVARIANTE 2 tras el corte por menor: el corte ES el corte (B1 del revisor)", () => {
  function underageCut(): CallDirectorState {
    const cut = decideCallDirective({ state: initialCallDirectorState(), signal: "underage" });
    expect(cut.directive.type).toBe("CLOSE_UNDERAGE");
    return cut.nextState;
  }

  it("una menor cortada NO recibe negocio: ni ingresos, ni conocimiento, ni identidad, ni reafirmación", () => {
    const state = underageCut();
    for (const signal of [
      "asks-earnings",
      "asks-covered",
      "asks-identity",
      "asks-age-policy",
      "distrust",
      "complains-about-share",
      "asks-unknown"
    ] as CallCandidateSignal[]) {
      const decision = decideCallDirective({ state, signal });
      expect(decision.directive.type, `señal ${signal} tras corte por menor`).toBe("CLOSE_UNDERAGE");
    }
  });

  it("tampoco promesas de contacto: ni despedida con 'te escribo' ni handoff con 'te paso con mi socio'", () => {
    const state = underageCut();
    expect(decideCallDirective({ state, signal: "wants-to-end" }).directive.type).toBe("CLOSE_UNDERAGE");
    expect(decideCallDirective({ state, signal: "wants-human" }).directive.type).toBe("CLOSE_UNDERAGE");
    expect(decideCallDirective({ state, signal: "hostile-or-suspicious" }).directive.type).toBe("CLOSE_UNDERAGE");
  });

  it("re-declarar 'tengo 16' tras el corte NO repite el corte en bucle (nota A del revisor)", () => {
    const state = underageCut();
    const first = decideCallDirective({ state, signal: "underage" });
    expect(first.directive.type).toBe("CLOSE_UNDERAGE"); // una repetición del corte, nada más
    const second = decideCallDirective({ state: first.nextState, signal: "underage" });
    expect(second.directive.type).toBe("STAY_SILENT");
    // El corte sigue registrado para el webhook (underage -> CLOSED).
    expect(second.nextState.closeDirective).toBe("CLOSE_UNDERAGE");
    // Y una menor recién declarada con OTRO cierre previo sigue cortándose (el gate no lo impide).
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const softClosed = decideCallDirective({ state: opened, signal: "not-interested" }).nextState;
    expect(decideCallDirective({ state: softClosed, signal: "underage" }).directive.type).toBe("CLOSE_UNDERAGE");
  });

  it("el corte se repite UNA vez y después silencio (sin loro tampoco aquí)", () => {
    const state = underageCut();
    const first = decideCallDirective({ state, signal: "asks-earnings" });
    expect(first.directive.type).toBe("CLOSE_UNDERAGE");
    const second = decideCallDirective({ state: first.nextState, signal: "follows-along" });
    expect(second.directive.type).toBe("STAY_SILENT");
    expect(second.nextState.closed).toBe(true);
    expect(second.nextState.closeDirective).toBe("CLOSE_UNDERAGE");
  });

  it("end-to-end por el responder: 'tengo 16' corta y '¿cuánto se gana?' NO recibe la charla de ingresos", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "es que en realidad tengo 16" },
      { role: "assistant", content: "corte por menor..." },
      { role: "user", content: "¿y cuánto se gana con esto?" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLOSE_UNDERAGE");
    expect(res.content.toLowerCase()).toContain("mayores de edad");
    expect(res.content.toLowerCase()).not.toContain("te sigo contando");
  });
});

describe("replay consistente con el atajo de ruido en vivo (R1/R2 del revisor)", () => {
  it("un '...' intercalado tras el cierre NO gasta la repetición: el siguiente 'dale' repite el cierre", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];
    let closed = false;
    for (let i = 0; i < 12 && !closed; i++) {
      messages.push({ role: "user", content: "vale" });
      const res = await respondToCall({ messages: [...messages] });
      messages.push({ role: "assistant", content: res.content || "(silencio)" });
      closed = res.directiveType === "CLOSE_WITH_CONTRACT";
    }
    expect(closed).toBe(true);

    // Ruido en vivo tras el cierre: silencio con traza honesta (STAY_SILENT).
    messages.push({ role: "user", content: "..." });
    const noise = await respondToCall({ messages: [...messages] });
    expect(noise.content).toBe("");
    expect(noise.directiveType).toBe("STAY_SILENT");
    messages.push({ role: "assistant", content: "(silencio)" });

    // La PRIMERA frase real tras el cierre sigue teniendo su repetición (el ruido no la consumió).
    messages.push({ role: "user", content: "dale, perfecto" });
    const repeat = await respondToCall({ messages: [...messages] });
    expect(repeat.directiveType).toBe("CLOSE_WITH_CONTRACT");
    expect(repeat.content.toLowerCase()).toContain("contrato");
  });
});

describe("despedida adaptada al cierre (N2 del revisor)", () => {
  it("tras CLOSE_SOFT ('no me interesa'), la despedida no dice '¡Genial!' ni promete escribir", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const closed = decideCallDirective({ state: opened, signal: "not-interested" }).nextState;
    const bye = decideCallDirective({ state: closed, signal: "wants-to-end" });
    expect(bye.directive.type).toBe("SAY_GOODBYE");
    const plan = planCallUtterance({ directive: bye.directive });
    expect(plan.deterministicText!.toLowerCase()).not.toContain("genial");
    expect(plan.deterministicText!.toLowerCase()).not.toContain("te escribo");
  });

  it("tras el cierre con contrato, la despedida sí anuncia el 'ahora te escribo' (el contrato va por WhatsApp)", () => {
    const state = closedState();
    const bye = decideCallDirective({ state, signal: "wants-to-end" });
    const plan = planCallUtterance({ directive: bye.directive });
    expect(plan.deterministicText!.toLowerCase()).toContain("te escribo");
  });

  it("'no me interesa' DESPUÉS del cierre con contrato -> despedida de declive, sin '¡Genial!' (nota B)", () => {
    const state = closedState();
    const bye = decideCallDirective({ state, signal: "not-interested" });
    expect(bye.directive.type).toBe("SAY_GOODBYE");
    const plan = planCallUtterance({ directive: bye.directive });
    expect(plan.deterministicText!.toLowerCase()).not.toContain("genial");
    expect(plan.deterministicText!.toLowerCase()).not.toContain("te escribo");
  });
});

describe("director: el handoff también se capa (invariante 4 intacto)", () => {
  it("tras el handoff, la primera frase real repite el mensaje; la segunda -> STAY_SILENT; sigue transferida", () => {
    const handed = runSignals(["none", "wants-human"]);
    expect(handed.handedOff).toBe(true);
    const first = decideCallDirective({ state: handed, signal: "follows-along" });
    expect(first.directive.type).toBe("HANDOFF_TO_ALEX");
    const second = decideCallDirective({ state: first.nextState, signal: "follows-along" });
    expect(second.directive.type).toBe("STAY_SILENT");
    expect(second.nextState.handedOff).toBe(true);
  });
});

describe("redacción: STAY_SILENT calla y SAY_GOODBYE es corta y sin cifras", () => {
  it("STAY_SILENT -> texto determinista vacío (no cae al guion de etapa)", () => {
    const plan = planCallUtterance({ directive: { type: "STAY_SILENT" } });
    expect(plan.deterministicText).toBe("");
    expect(plan.fallbackText).toBe("");
    expect(plan.draftingBrief).toBeUndefined();
  });

  it("SAY_GOODBYE -> despedida corta determinista, sin porcentajes", () => {
    const plan = planCallUtterance({ directive: { type: "SAY_GOODBYE" } });
    expect(plan.deterministicText ?? "").not.toBe("");
    expect(plan.deterministicText!.length).toBeLessThan(120);
    expect(plan.deterministicText!).not.toMatch(/\d+\s*%/);
  });
});

describe("responder end-to-end: el bucle 'dale, perfecto' de la simulación ya no repite el contrato", () => {
  it("tras el cierre: primera coletilla repite el cierre UNA vez, la segunda y siguientes callan", async () => {
    // Reproduce el embudo entero con "vale" (follows-along) hasta el cierre, como en la simulación real.
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];
    let closeText = "";
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: "vale" });
      const res = await respondToCall({ messages: [...messages] });
      messages.push({ role: "assistant", content: res.content || "(silencio)" });
      if (res.directiveType === "CLOSE_WITH_CONTRACT") {
        closeText = res.content;
        break;
      }
    }
    expect(closeText.length).toBeGreaterThan(0);

    // "dale, perfecto" tras el cierre: la primera vez puede repetir el cierre…
    messages.push({ role: "user", content: "dale, perfecto" });
    const repeat = await respondToCall({ messages: [...messages] });
    messages.push({ role: "assistant", content: repeat.content || "(silencio)" });

    // …pero la segunda y la tercera CALLAN (antes: bucle infinito del contrato).
    messages.push({ role: "user", content: "dale, perfecto" });
    const second = await respondToCall({ messages: [...messages] });
    expect(second.content).toBe("");
    messages.push({ role: "assistant", content: "(silencio)" });
    messages.push({ role: "user", content: "dale, perfecto" });
    const third = await respondToCall({ messages: [...messages] });
    expect(third.content).toBe("");
  });

  it("una pregunta real tras el cierre SÍ se responde (no silencio, no contrato repetido)", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];
    for (let i = 0; i < 12; i++) {
      messages.push({ role: "user", content: "vale" });
      const res = await respondToCall({ messages: [...messages] });
      messages.push({ role: "assistant", content: res.content || "(silencio)" });
      if (res.directiveType === "CLOSE_WITH_CONTRACT") break;
    }
    messages.push({ role: "user", content: "¿y cuánto ganaría yo al mes más o menos?" });
    const res = await respondToCall({ messages: [...messages] });
    expect(res.directiveType).toBe("GIVE_EARNINGS");
    expect(res.content.trim().length).toBeGreaterThan(0);
    expect(res.content).not.toContain("te paso el contrato");
  });
});

describe("muletillas (buffer words): rotan entre turnos para no sonar a disco rayado", () => {
  it("dos turnos redactados seguidos no emiten la misma muletilla", async () => {
    const buffers: string[] = [];
    const drafter = { draft: async () => "Genial, te cuento eso rapidito." };
    const base: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." }
    ];

    const turnOne: CallChatMessage[] = [...base, { role: "user", content: "vale" }];
    await respondToCall({ messages: turnOne, drafter, onDraftStart: (b) => buffers.push(b) });

    const turnTwo: CallChatMessage[] = [
      ...turnOne,
      { role: "assistant", content: "etapa 1..." },
      { role: "user", content: "vale" }
    ];
    await respondToCall({ messages: turnTwo, drafter, onDraftStart: (b) => buffers.push(b) });

    expect(buffers).toHaveLength(2);
    expect(buffers[0]).not.toBe(buffers[1]);
  });
});
