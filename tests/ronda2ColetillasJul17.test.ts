import { describe, expect, it } from "vitest";
import { respondToCall, stripTrailingCheckCloser } from "@/application/callTurnResponder";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// RONDA 2 de la estrategia "persona real" (17-jul). El panel de la 1ª llamada real cazó el tell nº1:
// los 10 turnos del bot acababan en pregunta-check ("¿vale?" / "¿me sigues?" / "¿te va?" / "¿cómo lo ves?").
// Criterio de Alex: "el vale me gusta como queda, pero no siempre" -> ALTERNANCIA: si el turno anterior del
// bot ya acabó en pregunta, este no remata con otra coletilla corta. Una pregunta REAL nunca se toca.

describe("stripTrailingCheckCloser: quita solo la coletilla corta final", () => {
  it("quita las coletillas de la lista", () => {
    expect(stripTrailingCheckCloser("Tú te encargas del contenido, ¿vale?")).toBe("Tú te encargas del contenido.");
    expect(stripTrailingCheckCloser("— tú no tienes que escribirte con nadie. ¿Me sigues?")).toBe(
      "— tú no tienes que escribirte con nadie."
    );
    expect(stripTrailingCheckCloser("Seguimos con el reparto, ¿te va?")).toBe("Seguimos con el reparto.");
    expect(stripTrailingCheckCloser("Por eso el reparto es así. ¿Cómo lo ves?")).toBe("Por eso el reparto es así.");
  });

  it("una pregunta REAL que TERMINA en un token de la lista no se mutila (revisor Ronda 2)", () => {
    expect(stripTrailingCheckCloser("Perfecto. ¿Te viene bien?")).toBe("Perfecto. ¿Te viene bien?");
    expect(stripTrailingCheckCloser("¿Cómo te va?")).toBe("¿Cómo te va?");
    expect(stripTrailingCheckCloser("¿Tienes OnlyFans o no?")).toBe("¿Tienes OnlyFans o no?");
  });

  it("'no sé si me estáis estafando' (peninsular) también es duda, no agresión (revisor Ronda 2)", async () => {
    const { classifyCallSignal } = await import("@/application/callSignalClassifier");
    expect(classifyCallSignal({ utterance: "no sé si me estáis estafando" })).toBe("distrust");
    expect(classifyCallSignal({ utterance: "me estáis estafando" })).toBe("hostile-or-suspicious"); // directa: sigue
  });

  it("no corta palabras POR DENTRO: '¿Mejor así?' se quita entero, nunca queda '¿Mejor a.' (bug Ronda 2)", () => {
    expect(stripTrailingCheckCloser("Drive es una carpeta online donde nos mandas el contenido. ¿Mejor así?")).toBe(
      "Drive es una carpeta online donde nos mandas el contenido."
    );
    // Y una frase que TERMINA en una palabra que contiene un check por dentro no se toca.
    expect(stripTrailingCheckCloser("Lo hacemos exactamente así.")).toBe("Lo hacemos exactamente así.");
  });

  it("NO toca preguntas reales ni turnos que son solo la coletilla", () => {
    expect(stripTrailingCheckCloser("Perdona, no te he pillado bien. ¿Me lo puedes repetir?")).toBe(
      "Perdona, no te he pillado bien. ¿Me lo puedes repetir?"
    );
    expect(stripTrailingCheckCloser("¿Qué día y hora te viene bien para la llamada?")).toBe(
      "¿Qué día y hora te viene bien para la llamada?"
    );
    expect(stripTrailingCheckCloser("¿vale?")).toBe("¿vale?"); // era todo el turno: se conserva
    expect(stripTrailingCheckCloser("Genial, pues quedamos así.")).toBe("Genial, pues quedamos así.");
  });
});

describe("alternancia en la llamada: dos turnos seguidos no acaban los dos en coletilla", () => {
  it("tras un turno del bot acabado en '?', el siguiente NO remata con otra coletilla (E2E determinista)", async () => {
    // Sin drafter: el responder usa los textos deterministas del guion (que sí traen coletillas de fábrica).
    const first = await respondToCall({
      messages: [
        { role: "assistant", content: "Hola Laura, soy Alex, el de Rose Models. ¿Te pillo bien? Te cuento rapidito, ¿vale?" },
        { role: "user", content: "si, dale" }
      ],
      candidateName: "Laura",
      recorded: false
    });
    // El turno anterior acabó en "?": este no puede acabar en coletilla corta de confirmación.
    expect(first.content).not.toMatch(/¿(?:vale|me sigues|te va|te parece|te cuadra(?: as[ií])?|c[oó]mo lo ves|bien)\?\s*$/i);

    // Y AL REVÉS: si el turno anterior NO acabó en pregunta, la coletilla se conserva (no siempre fuera —
    // el criterio de Alex es alternar, no eliminarlas todas).
    const second = await respondToCall({
      messages: [
        {
          role: "assistant",
          content: "Vale, pues mira, primero te cuento nuestra forma de trabajar y luego lo vemos todo con calma."
        },
        { role: "user", content: "vale" }
      ],
      candidateName: "Laura",
      recorded: false
    });
    // El guion de la siguiente etapa acaba en coletilla y el turno previo no preguntó: se mantiene tal cual.
    expect(second.content.trim().endsWith("?")).toBe(true);
  });
});

describe("duda enmarcada ≠ agresión (cazado en el barrido de la Ronda 2)", () => {
  it("'¿cómo sé que no me están estafando?' es DESCONFIANZA (tranquilizar), no handoff hostil", async () => {
    const { classifyCallSignal } = await import("@/application/callSignalClassifier");
    expect(classifyCallSignal({ utterance: "Ajá, pero cómo sé que no me están estafando, che." })).toBe("distrust");
    expect(classifyCallSignal({ utterance: "no sé si me están timando" })).toBe("distrust");
    // "¿cómo sé que NO ES una estafa?" (el ejemplo de libro de la desconfianza) también caía en hostil.
    expect(classifyCallSignal({ utterance: "Bueno, dale, pero corto y claro, ¿cómo sé que no es una estafa?" })).toBe("distrust");
    expect(classifyCallSignal({ utterance: "dime que no es un timo, porfa" })).not.toBe("hostile-or-suspicious");
    // La acusación DIRECTA sigue siendo agresión (no se debilita la seguridad).
    expect(classifyCallSignal({ utterance: "me estáis estafando, lo sé" })).toBe("hostile-or-suspicious");
    expect(classifyCallSignal({ utterance: "me están tomando el pelo, sois unos chorizos" })).toBe("hostile-or-suspicious");
    expect(classifyCallSignal({ utterance: "esto es una estafa" })).toBe("hostile-or-suspicious");
    // Si tras neutralizar el "no es una estafa" queda OTRO marcador hostil real, sigue escalando.
    expect(classifyCallSignal({ utterance: "no es una estafa, es que sois unos ladrones directamente" })).toBe(
      "hostile-or-suspicious"
    );
  });
});

describe("defensa del 70 (Ronda 2): sin recitar la misma lista ni re-preguntar la opinión recién dada", () => {
  it("el texto de DEFEND_SHARE no repite la enumeración de la presentación ni acaba en '¿cómo lo ves?'", () => {
    const plan = planCallUtterance({ directive: { type: "DEFEND_SHARE" } });
    const text = plan.deterministicText ?? plan.fallbackText;
    expect(text.toLowerCase()).not.toContain("monetización");
    expect(text.toLowerCase()).not.toContain("el equipo de chatters las 24 horas"); // la lista calcada de MONEY
    expect(text).not.toMatch(/¿c[oó]mo lo ves\?\s*$/i);
    // Sigue defendiendo el 70 con los hechos aprobados y pasa el validador (sin cifras nuevas ni inversión).
    expect(text.toLowerCase()).toContain("setenta");
    expect(validateCallUtterance(text).valid).toBe(true);
  });
});
