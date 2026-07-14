import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallContext } from "@/application/callContext";

// Sweep AR 14-jul (candidata "cara"): si ella insiste con la cara varias veces, la reconducción salía
// IDÉNTICA palabra por palabra (variantFor clampaba a la última de 2 variantes). Ahora hay 4 variantes y
// CICLA, así que dos reconducciones seguidas nunca son iguales. Determinista (sin drafter): usa el texto fijo.

const CTX: CallContext = { candidateName: "Ana", concerns: [] };

async function reconductTexts(faceUtterances: string[]): Promise<string[]> {
  const messages: CallChatMessage[] = [];
  const opener = await respondToCall({ messages, context: CTX, candidateName: "Ana" });
  messages.push({ role: "assistant", content: opener.content });
  const texts: string[] = [];
  for (const utterance of faceUtterances) {
    messages.push({ role: "user", content: utterance });
    const r = await respondToCall({ messages, context: CTX, candidateName: "Ana" });
    messages.push({ role: "assistant", content: r.content });
    if (r.directiveType === "RECONDUCT_FACE") texts.push(r.content);
  }
  return texts;
}

describe("reconducción de la cara: no se repite clavada (sweep AR 14-jul)", () => {
  it("varias dudas de cara seguidas -> reconducciones DISTINTAS, nunca dos idénticas seguidas", async () => {
    const texts = await reconductTexts([
      "me da corte lo de la cara",
      "me da cosa que me reconozca alguien conocido",
      "me da mucha verguenza mostrar la cara",
      "me da miedo que me vea mi familia"
    ]);
    expect(texts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < texts.length; i++) {
      expect(texts[i]).not.toBe(texts[i - 1]); // nunca dos reconducciones idénticas seguidas
    }
    // La cara sigue siendo imprescindible en todas, y NUNCA se promete ocultarla (invariante de la cara).
    for (const text of texts) {
      expect(text.toLowerCase()).toMatch(/imprescindible|confianza|cara/);
      expect(text.toLowerCase()).not.toMatch(/difumin|pixel|\btapar\b|anonim|nadie te reconoce|no se te ve/);
    }
  });
});
