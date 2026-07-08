import { describe, it, expect } from "vitest";
import {
  CALL_UNDERSTOOD_INTENTS,
  parseUnderstoodIntent,
  resolveRefinedSignal,
  type CallUnderstoodIntent
} from "@/application/callUnderstander";

describe("callUnderstander: parseo tolerante de la etiqueta del modelo", () => {
  it("reconoce cada etiqueta válida tal cual", () => {
    for (const intent of CALL_UNDERSTOOD_INTENTS) {
      expect(parseUnderstoodIntent(intent)).toBe(intent);
    }
  });

  it("tolera mayúsculas, espacios y puntuación alrededor", () => {
    expect(parseUnderstoodIntent("  Question. ")).toBe("question");
    expect(parseUnderstoodIntent("intent: distrust")).toBe("distrust");
    expect(parseUnderstoodIntent("FACE-CONCERN")).toBe("face-concern");
    expect(parseUnderstoodIntent('"age-policy"')).toBe("age-policy");
  });

  it("salida vacía / desconocida / nula -> null (se queda unclear, fallback seguro)", () => {
    expect(parseUnderstoodIntent("")).toBeNull();
    expect(parseUnderstoodIntent(null)).toBeNull();
    expect(parseUnderstoodIntent(undefined)).toBeNull();
    expect(parseUnderstoodIntent("banana")).toBeNull();
    expect(parseUnderstoodIntent("complains-about-share")).toBeNull(); // no está en el subconjunto seguro
  });
});

describe("callUnderstander: mapeo a señal (SOLO no-cambian-estado, invariante 1 + replay-safe)", () => {
  it("distrust/identity/earnings/age-policy/clarification -> señales asks-*/distrust directas", () => {
    expect(resolveRefinedSignal("distrust")).toEqual({ kind: "signal", signal: "distrust" });
    expect(resolveRefinedSignal("identity")).toEqual({ kind: "signal", signal: "asks-identity" });
    expect(resolveRefinedSignal("earnings")).toEqual({ kind: "signal", signal: "asks-earnings" });
    expect(resolveRefinedSignal("age-policy")).toEqual({ kind: "signal", signal: "asks-age-policy" });
    expect(resolveRefinedSignal("clarification")).toEqual({ kind: "signal", signal: "asks-clarification" });
  });

  it("question y face-concern se marcan aparte (las resuelve el responder con conocimiento)", () => {
    expect(resolveRefinedSignal("question")).toEqual({ kind: "question" });
    expect(resolveRefinedSignal("face-concern")).toEqual({ kind: "face-concern" });
  });

  it("none / null -> no se entendió (se queda unclear)", () => {
    expect(resolveRefinedSignal("none")).toEqual({ kind: "none" });
    expect(resolveRefinedSignal(null)).toEqual({ kind: "none" });
  });

  it("NINGUNA intención mapea a una señal que cambie el estado (avanzar/cerrar/negociar/handoff)", () => {
    const stateChanging = new Set([
      "follows-along",
      "none",
      "complains-about-share",
      "not-interested",
      "wants-to-think",
      "wants-to-end",
      "wants-human",
      "hostile-or-suspicious",
      "underage",
      "asks-share-figure"
    ]);
    for (const intent of CALL_UNDERSTOOD_INTENTS) {
      const res = resolveRefinedSignal(intent as CallUnderstoodIntent);
      if (res.kind === "signal") {
        expect(stateChanging.has(res.signal)).toBe(false);
      }
    }
  });
});
