import { describe, expect, it } from "vitest";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { runCallTurn } from "@/application/callBrain";
import { initialCallDirectorState, type CallDirectorState } from "@/application/callDirector";

function mockEntry(points: string[]): KnowledgeEntry {
  return {
    id: "mock",
    category: "FAQ",
    title: "mock",
    facts: [],
    approvedAnswerPoints: points,
    prohibitedClaims: [],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: [],
    requiresHumanReview: false,
    version: "1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-17"
  };
}

describe("cerebro de la llamada (end-to-end por turnos)", () => {
  it("camino feliz: apertura -> recorre la agenda -> cierra con contrato", () => {
    let state: CallDirectorState = initialCallDirectorState();
    const utterances = ["", "vale", "vale", "vale", "vale", "vale", "vale", "vale", "vale"];
    const types: string[] = [];
    let moneyFallback = "";

    for (const utterance of utterances) {
      const result = runCallTurn({ state, utterance, candidateName: "Lucía" });
      types.push(result.directive.type);
      if (result.directive.type === "COVER_STAGE" && result.directive.stageId === "MONEY") {
        moneyFallback = result.utterancePlan.fallbackText;
      }
      state = result.nextState;
    }

    // Lo primero es la apertura legal.
    expect(types[0]).toBe("GIVE_DISCLOSURE");
    // Por el medio se cubren etapas.
    expect(types).toContain("COVER_STAGE");
    // Acaba cerrando con el contrato; si sigue asintiendo, el cierre se repite UNA vez y luego silencio
    // (anti-loro jul-2026, detalle en callAntiLoopJul02).
    expect(types).toContain("CLOSE_WITH_CONTRACT");
    expect(types[types.length - 1]).toBe("STAY_SILENT");
    // El dinero se presenta FRESCO (sin "como te dije por Instagram") y lleva la cifra 70/30.
    expect(moneyFallback).not.toContain("Instagram");
    expect(moneyFallback).toContain("70");
    expect(moneyFallback).toContain("30");
  });

  it("la apertura es siempre el primer enunciado y saluda como Alex de Rose Models", () => {
    const result = runCallTurn({ state: initialCallDirectorState(), utterance: "hola buenas" });
    expect(result.directive.type).toBe("GIVE_DISCLOSURE");
    expect(result.utterancePlan.deterministicText?.toLowerCase()).toContain("rose models");
  });

  it("pregunta CUBIERTA (resolver encuentra conocimiento) -> responde con esos hechos", () => {
    const state = runCallTurn({ state: initialCallDirectorState(), utterance: "" }).nextState; // pasa la apertura
    const result = runCallTurn({
      state,
      utterance: "¿cuándo cobraría?",
      resolveQuestion: () => [mockEntry(["El cobro se liquida cada 14 días y tú cobras primero."])]
    });
    expect(result.signal).toBe("asks-covered");
    expect(result.directive.type).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(result.utterancePlan.fallbackText).toContain("14 días");
  });

  it("pregunta DESCONOCIDA (sin resolver) -> defiere a Alex, no improvisa", () => {
    const state = runCallTurn({ state: initialCallDirectorState(), utterance: "" }).nextState;
    const result = runCallTurn({ state, utterance: "¿y los impuestos cómo van?" });
    expect(result.signal).toBe("asks-unknown");
    expect(result.directive.type).toBe("DEFER_TO_PARTNER");
    expect(result.utterancePlan.fallbackText).toContain("socio");
  });

  it("desconfianza -> tranquiliza, con fallback no vacío", () => {
    const state = runCallTurn({ state: initialCallDirectorState(), utterance: "" }).nextState;
    const result = runCallTurn({ state, utterance: "no me fío, ¿esto es real?" });
    expect(result.signal).toBe("distrust");
    expect(result.directive.type).toBe("REASSURE");
    expect(result.utterancePlan.fallbackText.trim().length).toBeGreaterThan(0);
  });

  it("pide hablar con una persona -> handoff, y se queda en handoff", () => {
    const state = runCallTurn({ state: initialCallDirectorState(), utterance: "" }).nextState;
    const handoff = runCallTurn({ state, utterance: "quiero hablar con una persona" });
    expect(handoff.directive.type).toBe("HANDOFF_TO_ALEX");
    expect(handoff.nextState.handedOff).toBe(true);
    // Aunque luego asienta, sigue en handoff.
    const after = runCallTurn({ state: handoff.nextState, utterance: "vale" });
    expect(after.directive.type).toBe("HANDOFF_TO_ALEX");
  });
});
