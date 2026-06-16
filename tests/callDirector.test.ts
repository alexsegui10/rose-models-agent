import { describe, expect, it } from "vitest";
import {
  decideCallDirective,
  initialCallDirectorState,
  type CallCandidateSignal,
  type CallDirectorState
} from "@/application/callDirector";

/** Aplica una secuencia de señales partiendo del estado inicial y devuelve las directivas + estado final. */
function run(signals: CallCandidateSignal[]) {
  let state = initialCallDirectorState();
  const directives = signals.map((signal) => {
    const decision = decideCallDirective({ state, signal });
    state = decision.nextState;
    return decision.directive;
  });
  return { directives, state };
}

describe("director de la llamada", () => {
  it("lo primero SIEMPRE es la apertura legal (disclosure), una sola vez", () => {
    const first = decideCallDirective({ state: initialCallDirectorState(), signal: "none" });
    expect(first.directive.type).toBe("GIVE_DISCLOSURE");
    expect(first.nextState.disclosureGiven).toBe(true);
  });

  it("tras la apertura, recorre la agenda en orden y cierra con el contrato", () => {
    // disclosure + tantas señales 'follows-along' como etapas hay (8) para recorrer todo.
    const { directives } = run(["none", ...Array(8).fill("follows-along")] as CallCandidateSignal[]);
    expect(directives[0].type).toBe("GIVE_DISCLOSURE");
    const covered = directives.filter((d) => d.type === "COVER_STAGE").map((d) => d.stageId);
    expect(covered[0]).toBe("RAPPORT");
    expect(covered).toContain("HOW_AGENCY_WORKS");
    expect(covered).toContain("MONEY");
    expect(covered).toContain("BOUNDARIES");
    // La última directiva es el cierre con contrato.
    expect(directives[directives.length - 1].type).toBe("CLOSE_WITH_CONTRACT");
  });

  it("al introducir MONEY adjunta la oferta inicial determinista 70/30", () => {
    const { directives } = run(["none", ...Array(8).fill("follows-along")] as CallCandidateSignal[]);
    const money = directives.find((d) => d.type === "COVER_STAGE" && d.stageId === "MONEY");
    expect(money?.shareOffer?.modelShare).toBe(70);
    expect(money?.shareOffer?.agencyShare).toBe(30);
  });

  it("pregunta cubierta -> responde del conocimiento sin avanzar la agenda", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const before = [...state.coveredStages];
    const decision = decideCallDirective({ state, signal: "asks-covered" });
    expect(decision.directive.type).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(decision.nextState.coveredStages).toEqual(before);
  });

  it("pregunta no cubierta -> defiere a Alex ('mi socio'), no improvisa", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const decision = decideCallDirective({ state, signal: "asks-unknown" });
    expect(decision.directive.type).toBe("DEFER_TO_PARTNER");
  });

  it("desconfianza leve -> tranquiliza y sigue", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    expect(decideCallDirective({ state, signal: "distrust" }).directive.type).toBe("REASSURE");
  });

  it("pide hablar con una persona -> handoff pegajoso", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const decision = decideCallDirective({ state, signal: "wants-human" });
    expect(decision.directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decision.directive.handoffReason).toBe("asked-for-human");
    expect(decision.nextState.handedOff).toBe(true);
    // Pegajoso: aunque luego asienta, el bot no retoma el guion.
    const after = decideCallDirective({ state: decision.nextState, signal: "follows-along" });
    expect(after.directive.type).toBe("HANDOFF_TO_ALEX");
  });

  it("agresión/sospecha grave -> handoff", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const decision = decideCallDirective({ state, signal: "hostile-or-suspicious" });
    expect(decision.directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decision.directive.handoffReason).toBe("suspicion-or-aggression");
  });

  it("si se queja del reparto antes de presentarlo, primero presenta el 70/30 (no concede sin oferta)", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    // MONEY aún no cubierto: la primera queja presenta el reparto, no baja directamente.
    const decision = decideCallDirective({ state, signal: "complains-about-share" });
    expect(decision.directive.type).toBe("COVER_STAGE");
    expect(decision.directive.stageId).toBe("MONEY");
    expect(decision.directive.shareOffer?.modelShare).toBe(70);
    expect(decision.nextState.coveredStages).toContain("MONEY");
  });

  it("negociación del reparto (ya presentado): 70 -> (queja) 65 -> (queja) 60 -> (sigue) handoff a Alex", () => {
    // Arrancamos con MONEY ya presentado (queja previa) para ejercitar la escalera.
    let state: CallDirectorState = decideCallDirective({
      state: initialCallDirectorState(),
      signal: "none"
    }).nextState;
    state = decideCallDirective({ state, signal: "complains-about-share" }).nextState; // presenta 70/30, cubre MONEY

    const first = decideCallDirective({ state, signal: "complains-about-share" });
    expect(first.directive.type).toBe("CONCEDE_SHARE");
    expect(first.directive.shareOffer?.modelShare).toBe(65);
    state = first.nextState;

    const second = decideCallDirective({ state, signal: "complains-about-share" });
    expect(second.directive.type).toBe("CONCEDE_SHARE");
    expect(second.directive.shareOffer?.modelShare).toBe(60);
    expect(second.directive.shareOffer?.isFloor).toBe(true);
    state = second.nextState;

    // En el suelo (60) y sigue quejándose -> fuera del margen del bot -> Alex.
    const third = decideCallDirective({ state, signal: "complains-about-share" });
    expect(third.directive.type).toBe("HANDOFF_TO_ALEX");
    expect(third.directive.handoffReason).toBe("share-rejected-at-floor");
    expect(third.nextState.handedOff).toBe(true);
  });

  it("quiere terminar -> cierre con contrato", () => {
    const state = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    expect(decideCallDirective({ state, signal: "wants-to-end" }).directive.type).toBe("CLOSE_WITH_CONTRACT");
  });

  it("cierre PEGAJOSO: tras cerrar con el contrato no reabre negociación ni guion", () => {
    const { state } = run(["none", ...Array(8).fill("follows-along")] as CallCandidateSignal[]);
    expect(state.closed).toBe(true);
    // Una queja del reparto DESPUÉS del cierre no reabre la negociación: repite el cierre.
    expect(decideCallDirective({ state, signal: "complains-about-share" }).directive.type).toBe("CLOSE_WITH_CONTRACT");
    // Una pregunta tras el cierre tampoco reabre conversación sustantiva.
    expect(decideCallDirective({ state, signal: "asks-covered" }).directive.type).toBe("CLOSE_WITH_CONTRACT");
    // Pero la SEGURIDAD sigue: agresión o pedir persona tras el cierre escalan.
    expect(decideCallDirective({ state, signal: "hostile-or-suspicious" }).directive.type).toBe("HANDOFF_TO_ALEX");
    expect(decideCallDirective({ state, signal: "wants-human" }).directive.type).toBe("HANDOFF_TO_ALEX");
  });
});
