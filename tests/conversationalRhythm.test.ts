import { describe, expect, it } from "vitest";
import { applyConversationalRhythm } from "@/application/conversationEngine";

// Control determinista del ritmo (decision de Alex 14-jun): el codigo evita el patron robotico de
// abrir cada mensaje con acuse o repetir el nombre. Solo recorta el saludo de apertura.

describe("applyConversationalRhythm", () => {
  it("strips the leading acknowledgement when the previous agent message also opened with one", () => {
    const result = applyConversationalRhythm("Vale Ana\n\nDe que pais eres?", ["Perfecto\n\nQue edad tienes?"], "Ana");
    expect(result).toBe("De que pais eres?");
  });

  it("keeps the acknowledgement when the previous agent message did not open with one", () => {
    const result = applyConversationalRhythm("Vale\n\nDe que pais eres?", ["De que pais eres?"], undefined);
    expect(result).toBe("Vale\n\nDe que pais eres?");
  });

  it("drops the name (but keeps the acuse) when the name was used in a recent message", () => {
    const result = applyConversationalRhythm("Perfecto Ana\n\nTienes of?", ["Vale Ana pues", "Hola, dime"], "Ana");
    // Ana se uso hace nada -> se quita el nombre, se conserva 'Perfecto'.
    expect(result).toBe("Perfecto\n\nTienes of?");
  });

  it("leaves a message that does not open with an acknowledgement untouched", () => {
    const result = applyConversationalRhythm("De que pais eres?", ["Perfecto\n\nQue edad tienes?"], "Ana");
    expect(result).toBe("De que pais eres?");
  });

  it("does not strip when there is no previous agent message and the name is new", () => {
    const result = applyConversationalRhythm("Perfecto Ana\n\nQue edad tienes?", [], "Ana");
    expect(result).toBe("Perfecto Ana\n\nQue edad tienes?");
  });

  it("handles a comma-separated opener too y recapitaliza el resto", () => {
    const result = applyConversationalRhythm("Vale Ana, y de que pais eres?", ["Okeyy\n\nQue movil tienes?"], "Ana");
    // Al recortar el acuse de apertura, la primera letra del resto se pone en mayuscula (no fragmentos
    // en minuscula tipo "y de que pais eres?").
    expect(result).toBe("Y de que pais eres?");
  });
});
