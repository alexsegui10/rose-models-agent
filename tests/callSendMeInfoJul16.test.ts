import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

const sig = (utterance: string, isCoveredQuestion?: boolean) => classifyCallSignal({ utterance, isCoveredQuestion });

// Barrido de voz 16-jul (persona desconfiada, Romina, l.47): "Bueno, mandámelo, pero si no está claro
// ni en pedo sigo." caía en `unclear` -> ASK_REPEAT ("no te he pillado bien con la línea, ¿me lo repites?"),
// fingiendo sordera a una frase PERFECTAMENTE clara. Es una petición IMPERATIVA de que le manden la info
// (consentimiento, a veces condicional), no ruido. Debe asentir y seguir (follows-along), NUNCA ASK_REPEAT.
describe("petición 'mandámelo/pásame' no es ruido: follows-along, no ASK_REPEAT (barrido voz 16-jul)", () => {
  it("la frase EXACTA de la desconfiada ('mandámelo, pero si no está claro no sigo') -> follows-along", () => {
    expect(sig("Bueno, mandámelo, pero si no está claro ni en pedo sigo.")).toBe("follows-along");
  });

  it("otras formas imperativas de 'envíame la info' -> follows-along (no fingir sordera)", () => {
    expect(sig("mandámelo por whatsapp")).toBe("follows-along");
    expect(sig("mandame eso")).toBe("follows-along");
    expect(sig("pasame los datos")).toBe("follows-along");
    expect(sig("pasámelo y lo veo")).toBe("follows-along");
    expect(sig("enviámelo por favor")).toBe("follows-along");
    expect(sig("tirámelo por whatsapp")).toBe("follows-along");
    // Plurales ("mandámelos", "pasámelas"): también son consentimiento, no ruido (barrido voz 16-jul, l.25).
    expect(sig("mandámelos y veo")).toBe("follows-along");
    expect(sig("pasámelas por whatsapp")).toBe("follows-along");
  });

  it("NO se traga la petición de la CIFRA del reparto (eso es asks-share-figure / nº1, no follows-along)", () => {
    // El fix excluye términos de reparto/dinero: "mándame la cifra/el reparto" NO se aplana a follows-along,
    // para no enmascarar el bug de la negociación (nº1) — se deja en su ruta.
    expect(sig("mandame la cifra del reparto")).not.toBe("follows-along");
    expect(sig("pasame el porcentaje")).not.toBe("follows-along");
  });

  it("no rompe el 'no te pillo' legítimo: ruido de verdad sigue siendo unclear", () => {
    expect(sig("xghj kkk")).toBe("unclear");
    expect(sig("eeh... esto... mmm")).toBe("unclear");
  });

  it("una PREGUNTA con 'me lo mandas?' sigue siendo pregunta (la caza QUESTION antes)", () => {
    // "¿me lo puedes mandar?" lleva verbo interrogativo -> asks-*; no la toca el recognizer nuevo.
    expect(sig("¿me lo puedes mandar por whatsapp?", true)).toBe("asks-covered");
  });
});
