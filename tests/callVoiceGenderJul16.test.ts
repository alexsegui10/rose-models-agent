import { describe, expect, it } from "vitest";
import { validateCallUtterance } from "@/application/callRedactionValidator";
import { buildDraftPrompt } from "@/application/openaiCallDrafter";
import type { CallDraftingBrief } from "@/application/callRedaction";

// Barrido de voz 16-jul (nº3): el bot es Alex (HOMBRE) y la agencia se dice "nosotros"; el redactor LLM a
// veces soltaba "nosotras" (femenino), un tell de IA. El bot de TEXTO ya fija el género en su prompt
// (openaiProvider); el de VOZ no lo tenía. Dos palancas: pin en el prompt de voz (reduce que salga) + red
// en el validador (lo garantiza: si sale, se descarta y habla el fallback determinista, que dice "nosotros").

describe("nº3 género: la voz de la agencia es masculina, 'nosotras' es un tell (barrido voz 16-jul)", () => {
  it("el validador RECHAZA un draft con 'nosotras' (auto-referencia en femenino)", () => {
    expect(validateCallUtterance("Nosotras llevamos toda la gestión, tú solo el contenido.").valid).toBe(false);
    expect(validateCallUtterance("aquí estamos todas para acompañarte").valid).toBe(false);
  });

  it("el validador ACEPTA 'nosotros' y no toca 'las chicas' (las modelos SÍ son mujeres)", () => {
    expect(validateCallUtterance("Nosotros llevamos toda la gestión, tú solo el contenido.").valid).toBe(true);
    // "las chicas" se refiere a las MODELOS (mujeres): no es un tell, no se debe rechazar.
    expect(validateCallUtterance("Muchas de las chicas al principio tienen esa duda, es normal.").valid).toBe(true);
  });

  it("el prompt del redactor de voz fija el género MASCULINO (nunca 'nosotras')", () => {
    const brief: CallDraftingBrief = {
      instruction: "presentarte",
      groundingFacts: [],
      prohibitedClaims: [],
      mandatoryNuances: [],
      referenceInstagram: false
    };
    const prompt = buildDraftPrompt({ brief, directiveType: "COVER_STAGE" });
    expect(prompt.toLowerCase()).toContain("nosotras");
    expect(prompt.toLowerCase()).toMatch(/masculin|hombre/);
  });
});
