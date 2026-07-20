import { describe, expect, it } from "vitest";
import { stripTrailingCheckCloser } from "@/application/callTurnResponder";

// El pacing 20-jul (quédate-en-el-tema) hace que las respuestas rematen con "¿te queda claro? / ¿alguna otra
// duda de esto?". Para que NO se encadenen turno a turno (tell de robot nº1), la red anti-coletilla debe
// reconocerlas y recortarlas cuando el turno anterior ya acabó en "?" (nota del revisor 20-jul).

describe("stripTrailingCheckCloser reconoce las nuevas comprobaciones de comprensión", () => {
  it("recorta '¿te queda claro?' y sus variantes, dejando puntuación limpia", () => {
    expect(stripTrailingCheckCloser("Sí, Drive es una app. ¿Te queda claro?")).toBe("Sí, Drive es una app.");
    expect(stripTrailingCheckCloser("Lo editamos nosotros. ¿Te queda claro esto?")).toBe("Lo editamos nosotros.");
    expect(stripTrailingCheckCloser("Va todo a tu nombre. ¿Te queda más claro ahora?")).toBe("Va todo a tu nombre.");
  });
  it("recorta la forma compuesta y la de 'alguna otra duda'", () => {
    expect(stripTrailingCheckCloser("La cuenta lleva otro nombre. ¿Te queda claro o tienes alguna otra duda?")).toBe(
      "La cuenta lleva otro nombre."
    );
    expect(stripTrailingCheckCloser("Nosotros llevamos el resto. ¿Alguna otra duda de esto?")).toBe(
      "Nosotros llevamos el resto."
    );
  });
  it("no toca las coletillas de siempre ni una pregunta REAL", () => {
    expect(stripTrailingCheckCloser("Va por reparto. ¿Te parece?")).toBe("Va por reparto.");
    // Pregunta de contenido real (no coletilla-check): se conserva.
    expect(stripTrailingCheckCloser("¿Tienes OnlyFans o no?")).toBe("¿Tienes OnlyFans o no?");
  });
});
