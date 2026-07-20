import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

// Barrido de voz 20-jul (Malena): "mandar contenido a Drive no me jode tanto" (modismo AR = "no me molesta
// tanto", SUAVE) se leía como hostil y se la mandaba a handoff como enojada. Raíz: "me jode" (me molesta) NO
// es el insulto en sí. Se neutraliza "me jode" entero, SIN tocar "no me jodas" (imperativo = insulto real).

describe("'me jode' (me molesta) NO es agresión; los insultos reales SÍ", () => {
  const NO_HOSTIL = [
    "mandar contenido a Drive no me jode tanto", // Malena
    "me jode un poco el porcentaje la verdad",
    "es lo que más me jode de todo esto",
    "no me jode para nada, es solo una duda"
  ];
  for (const u of NO_HOSTIL) {
    it(`NO es hostil: "${u}"`, () => {
      expect(classifyCallSignal({ utterance: u })).not.toBe("hostile-or-suspicious");
    });
  }

  const HOSTIL = [
    "que te follen", // insulto directo
    "no me jodas, sois unos estafadores", // "no me jodas" + insulto
    "sois una mierda", // insulto
    "jodete", // insulto
    "sois unos ladrones" // acusación directa
  ];
  for (const u of HOSTIL) {
    it(`SÍ es hostil: "${u}"`, () => {
      expect(classifyCallSignal({ utterance: u })).toBe("hostile-or-suspicious");
    });
  }
});
