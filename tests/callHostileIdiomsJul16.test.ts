import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

const sig = (utterance: string, isCoveredQuestion?: boolean) => classifyCallSignal({ utterance, isCoveredQuestion });

// Barrido de voz 16-jul: dos modismos rioplatenses caían por error en `hostile-or-suspicious` -> HANDOFF a
// Alex con motivo "suspicion-or-aggression", tratando como agresión a candidatas VÁLIDAS:
//   - Belen (mala conexión, l.139): "acá no escucho una mierda" = "no oigo nada" (mala señal), NO insulto.
//   - Priscila (cara, l.283): "es lo que más me jode" = señalar un tema que le molesta, NO ataque a la agencia.
// El fix añade excepciones a HOSTILE SOLO para estos sentidos, degradando a hostil únicamente si el modismo
// era el ÚNICO disparador. La agresión REAL debe seguir escalando (protección de regresión abajo).
describe("modismos AR no son agresión: no falso-positivo de hostile (barrido voz 16-jul)", () => {
  it("'no escucho una mierda' (mala señal) NO es hostil", () => {
    expect(sig("no escucho una mierda")).not.toBe("hostile-or-suspicious");
    expect(sig("no se escucha una mierda acá")).not.toBe("hostile-or-suspicious");
    expect(sig("no te entiendo una mierda, se corta")).not.toBe("hostile-or-suspicious");
    // Variantes rioplatenses con "ni" ("no oigo ni mierda" / "ni una mierda"): también son mala señal.
    expect(sig("no escucho ni una mierda acá")).not.toBe("hostile-or-suspicious");
    expect(sig("no se oye ni mierda")).not.toBe("hostile-or-suspicious");
    // La frase EXACTA de Belen (empieza con "sí" y acaba en "dale"): asiente -> follows-along, no handoff.
    expect(sig("sí, mejor por whatsapp, porque acá no escucho una mierda, dale")).toBe("follows-along");
  });

  it("'(es) lo que más me jode' (objeción/tema que molesta) NO es hostil", () => {
    expect(sig("es lo que más me jode", true)).not.toBe("hostile-or-suspicious");
    expect(sig("lo que me jode es tener que dar la cara", true)).not.toBe("hostile-or-suspicious");
    // La frase EXACTA de Priscila: pregunta por la cara ("decime bien lo de la cara") -> no handoff hostil.
    expect(
      sig("Sí, te sigo, pero yo no tengo OnlyFans todavía y decime bien lo de la cara porque es lo que más me jode.")
    ).not.toBe("hostile-or-suspicious");
  });

  // ─── PROTECCIÓN DE REGRESIÓN: la agresión REAL sigue escalando a handoff ────────────────────────────
  it("REGRESIÓN: insultos y acusaciones REALES siguen siendo hostile-or-suspicious", () => {
    expect(sig("esto es una mierda, sois unos estafadores de mierda")).toBe("hostile-or-suspicious");
    expect(sig("qué mierda me estás contando")).toBe("hostile-or-suspicious");
    expect(sig("menuda estafa de mierda")).toBe("hostile-or-suspicious");
    expect(sig("vaya mierda de agencia")).toBe("hostile-or-suspicious");
    expect(sig("no me jodas")).toBe("hostile-or-suspicious");
    expect(sig("eres imbécil")).toBe("hostile-or-suspicious");
    expect(sig("sois unos ladrones")).toBe("hostile-or-suspicious");
  });

  it("REGRESIÓN: agresión REAL que ADEMÁS lleva el modismo sigue siendo hostil (no la excusa)", () => {
    // Tiene "una mierda" hostil (no auditivo) Y "lo que me jode": el otro insulto real manda -> hostil.
    expect(sig("sois una mierda, es lo que más me jode de vosotros")).toBe("hostile-or-suspicious");
    // "me jode" directo (no "lo que me jode") + insulto -> sigue hostil.
    expect(sig("me jode que me mientan, sois unos chorizos")).toBe("hostile-or-suspicious");
  });
});
