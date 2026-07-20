import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

// Barrido de manipuladoras 20-jul (Sabri): "¿sos humano de verdad?" caía en asks-covered y el bot daba una
// respuesta rota/desconectada. Raíz: BOT_CHECK tenía "eres humano/persona" (España) pero NO el voseo AR "sos
// humano/persona/real". Ahora la pregunta de identidad "¿sos bot/humano/persona?" -> asks-identity (el bot
// dice quién es, como Alex, sin respuesta rota). NO confundir con PEDIR una persona (eso es wants-human).

describe("¿sos un bot/humano/persona? -> asks-identity (voseo AR incluido)", () => {
  const IDENTIDAD = [
    "sos humano de verdad o me chamuyas che",
    "sos una persona real posta",
    "vos sos de verdad o sos una maquina",
    "sos un bot, jurame",
    "eres humano de verdad", // España, control
    "hablo con una persona o con un robot"
  ];
  for (const u of IDENTIDAD) {
    it(`asks-identity: "${u}"`, () => {
      expect(classifyCallSignal({ utterance: u })).toBe("asks-identity");
    });
  }

  it("PEDIR una persona ('pasame con una persona') sigue siendo wants-human, no asks-identity", () => {
    expect(classifyCallSignal({ utterance: "un bot no me sirve, pasame con una persona de verdad" })).toBe("wants-human");
    expect(classifyCallSignal({ utterance: "no quiero hablar con un robot" })).toBe("wants-human");
  });
});
