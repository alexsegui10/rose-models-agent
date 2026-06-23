import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { runCallTurn } from "@/application/callBrain";

// Verificacion E2E del subsistema de voz (Alex 23-jun): la auditoria encontro (a) que una MENOR en la llamada
// no disparaba ningun corte (invariante 2 inexistente en la voz) y (b) que el clasificador no pillaba quejas
// del reparto muy comunes, asi que la negociacion 70->65->60 no arrancaba.

describe("Llamada — SEGURIDAD: menor de edad corta la llamada (invariante 2 en la voz)", () => {
  for (const phrase of [
    "en realidad tengo 16 años",
    "es que tengo 17",
    "soy menor de edad",
    "todavia no tengo 18",
    "tengo dieciseis",
    "uy tengo 15 anitos"
  ]) {
    it(`clasifica "${phrase}" como underage`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("underage");
    });
  }

  for (const adult of ["tengo 18", "tengo 22 años", "tengo 30", "tengo 16 seguidores nada mas", "subo 16 fotos"]) {
    it(`NO marca underage a una adulta / contexto no-edad: "${adult}"`, () => {
      expect(classifyCallSignal({ utterance: adult })).not.toBe("underage");
    });
  }

  it("una declaracion de menor CORTA con CLOSE_UNDERAGE incluso antes de la apertura legal", () => {
    const decision = decideCallDirective({ state: initialCallDirectorState(), signal: "underage" });
    expect(decision.directive.type).toBe("CLOSE_UNDERAGE");
    expect(decision.nextState.closed).toBe(true);
  });

  it("tras cortar por menor, el bot NO reabre el guion ni ofrece contrato (cierre pegajoso)", () => {
    const cut = decideCallDirective({ state: initialCallDirectorState(), signal: "underage" }).nextState;
    const next = decideCallDirective({ state: cut, signal: "follows-along" });
    expect(next.directive.type).toBe("CLOSE_UNDERAGE");
  });

  it("runCallTurn: 'tengo 16 años' produce el corte seguro determinista (mayores de edad)", () => {
    const result = runCallTurn({ state: initialCallDirectorState(), utterance: "en realidad tengo 16 años" });
    expect(result.directive.type).toBe("CLOSE_UNDERAGE");
    expect(result.utterancePlan.deterministicText?.toLowerCase()).toContain("mayores de edad");
  });
});

describe("Llamada — quejas del reparto comunes disparan la negociacion", () => {
  for (const complaint of ["70 es mucho, quiero mas para mi", "uff 70 me parece demasiado", "el 30 para mi es muy poco"]) {
    it(`"${complaint}" -> complains-about-share`, () => {
      expect(classifyCallSignal({ utterance: complaint })).toBe("complains-about-share");
    });
  }

  for (const followup of [
    "quiero mas para mi",
    "tendria que ser 50/50",
    "mitad y mitad o nada",
    "me gustaria quedarme con mas"
  ]) {
    it(`en negociacion, "${followup}" -> complains-about-share`, () => {
      expect(classifyCallSignal({ utterance: followup, moneyContext: true })).toBe("complains-about-share");
    });
  }
});
