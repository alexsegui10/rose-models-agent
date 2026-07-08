import { describe, it, expect } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

// Endurecimiento tras el sweep de simulacros 8-jul (workflow adversarial). Cada bloque = un misroute REAL
// cazado en el transcript. Son fixes SEGUROS del "oido" determinista (whitelist), sin tocar %/edad/cierre.

const sig = (utterance: string, extra: Parameters<typeof classifyCallSignal>[0] = { utterance }) =>
  classifyCallSignal({ ...extra, utterance });

describe("A. 'si/ya/vale/bueno + PERO' = concesion+objecion (yes-but), NUNCA asentimiento", () => {
  // Antes: "ya pero mi novio no se si lo va a llevar bien" casaba FOLLOWS_ALONG por el "ya" inicial ->
  // follows-along -> el bot AVANZABA atropellando la objecion de la pareja. Debe caer a unclear (la
  // comprension lo entiende como duda) en vez de asentir.
  for (const phrase of [
    "ya pero mi novio no se si lo va a llevar bien",
    "vale pero es que no se si tendre tiempo",
    "si pero me da cosa la verdad",
    "bueno pero y si me reconocen",
    "ya pero no lo veo claro"
  ]) {
    it(`"${phrase}" -> NO follows-along`, () => {
      expect(sig(phrase)).not.toBe("follows-along");
    });
  }

  it("un asentimiento normal SIGUE siendo follows-along (no romper)", () => {
    expect(sig("ya vale, cuentame")).toBe("follows-along");
    expect(sig("si claro, dale")).toBe("follows-along");
    expect(sig("vale perfecto")).toBe("follows-along");
  });

  it("'vale pero cuanto gano?' sigue siendo pregunta (QUESTION gana antes que el guard)", () => {
    expect(sig("vale pero cuanto gano?")).toBe("asks-earnings");
  });
});

describe("B. 'que' pelado y peticiones de recap -> asks-bot-to-repeat (no deferir a WhatsApp)", () => {
  it("'que' sin signo -> asks-bot-to-repeat (STT suele omitir el '?')", () => {
    expect(sig("que")).toBe("asks-bot-to-repeat");
    expect(sig("que?")).toBe("asks-bot-to-repeat");
  });

  it("peticiones de recap con gerundio -> asks-bot-to-repeat", () => {
    const lastBotUtterance = "primero te cuento como trabajamos";
    expect(sig("perdona me he liado, que me estabas contando?", { utterance: "x", lastBotUtterance })).toBe("asks-bot-to-repeat");
    expect(sig("que estabas diciendo", { utterance: "x", lastBotUtterance })).toBe("asks-bot-to-repeat");
    expect(sig("que me estabas explicando", { utterance: "x", lastBotUtterance })).toBe("asks-bot-to-repeat");
  });
});

describe("C. Slang AR de ingresos -> asks-earnings (candidatas argentinas)", () => {
  for (const phrase of ["posta que se garpa bien?", "che se garpa bien esto?", "y se garpa?"]) {
    it(`"${phrase}" -> asks-earnings`, () => {
      expect(sig(phrase)).toBe("asks-earnings");
    });
  }

  it("'como viene la mano' -> seguir/continuar (no deferir a WhatsApp)", () => {
    expect(sig("che y esto como viene la mano")).toBe("follows-along");
  });
});
