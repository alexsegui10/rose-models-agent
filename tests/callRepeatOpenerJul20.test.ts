import { describe, expect, it } from "vitest";
import { planCallUtterance } from "@/application/callRedaction";

// Barrido de voz 20-jul (distraida-nenes): al pedir "¿qué me decías?" justo tras el SALUDO, el bot re-leía la
// apertura ENTERA palabra por palabra ("Sí, te decía: Hola Yesica, soy Alex, el de Rose Models, hablamos por
// Instagram... ¿te pillo bien?") — re-saludar así suena a robot (tell de IA). Ahora, si lo que tocaría repetir
// es el saludo/apertura, usa el re-arranque corto y humano. El eco COMPLETO se reserva para CONTENIDO real.

const OPENER =
  "Hola Yesica, soy Alex, el de Rose Models, hablamos por Instagram hace poco. ¿Te pillo bien? Te cuento rapidito cómo trabajamos, ¿vale?";
const CONTENT = "Va por reparto, treinta por ciento para ti y setenta para la agencia, y cobras cada catorce días.";

describe("REPEAT_LAST_UTTERANCE no re-saluda con la apertura entera (suena a persona)", () => {
  it("si lo último fue el SALUDO -> re-arranque corto, NO re-lee 'Hola, soy Alex... te pillo bien'", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: OPENER,
      utterance: "¿qué me decías?"
    });
    const text = (plan.deterministicText ?? plan.fallbackText ?? "").toLowerCase();
    expect(text).not.toContain("te pillo bien");
    expect(text).not.toContain("hablamos por instagram");
    expect(text).toContain("cómo trabajamos");
  });

  it("si lo último fue CONTENIDO real -> lo repite (no se rompe el caso legítimo de mala conexión)", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: CONTENT,
      utterance: "¿qué dijiste? se cortó"
    });
    const text = (plan.deterministicText ?? plan.fallbackText ?? "").toLowerCase();
    expect(text).toContain("reparto");
    expect(text).toContain("catorce");
  });

  it("si lo último fue la IDENTIDAD ('¿quién sos?') -> se re-lee (no confundir con la apertura; nota revisor)", () => {
    const identity = "Que soy Alex, el de Rose Models, el que te escribió por Instagram para lo de las cuentas.";
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: identity,
      utterance: "¿qué me decías?"
    });
    const text = (plan.deterministicText ?? plan.fallbackText ?? "").toLowerCase();
    expect(text).toContain("soy alex");
    expect(text).not.toContain("te estaba contando cómo trabajamos");
  });
});
