import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// Barrido de la Fase 2 (23-jul): dos bugs reales cazados con luna en conversación.

describe("'me cuelgo' (AR = me despisto) NO es querer colgar (Malena: cerró la llamada a mitad)", () => {
  it("la frase exacta de Malena ya no cierra", () => {
    const s = classifyCallSignal({
      utterance: "eso me sirve, aunque dos días capaz sí, capaz me cuelgo y después me quiero matar"
    });
    expect(s).not.toBe("wants-to-end");
  });
  it("colgar DE VERDAD sigue contando", () => {
    expect(classifyCallSignal({ utterance: "te cuelgo que me voy" })).toBe("wants-to-end");
    expect(classifyCallSignal({ utterance: "bueno te dejo, hablamos luego" })).toBe("wants-to-end");
  });
});

describe("'¿la crean ustedes de cero?' responde (over-defer recurrente de Romina/Florencia/Micaela)", () => {
  const opened: CallChatMessage[] = [
    { role: "system", content: "p" },
    { role: "assistant", content: "Hola, soy Alex de Rose Models, te cuento cómo trabajamos, ¿vale?" }
  ];
  const FRASES = [
    "Okay, pero yo no tengo OnlyFans todavía, ¿ustedes lo crean de cero también o cómo es?",
    "¿o sea que ni tengo cuenta y ustedes quieren que arranque de cero?",
    "yo no tengo OnlyFans, ¿eso da igual o lo tengo que abrir antes?"
  ];
  for (const frase of FRASES) {
    it(`responde con conocimiento (no defer): "${frase}"`, async () => {
      const res = await respondToCall({ messages: [...opened, { role: "user", content: frase }] });
      expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    });
  }
});
