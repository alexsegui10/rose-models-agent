import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { extractCallFacts } from "@/application/callFactExtractor";

// Barrido de voz 20-jul. #5: el override de impuestos usaba \bdeclar\w* y pisaba (forzaba asks-unknown)
// preguntas de identidad/privacidad cubiertas, porque "declararme/me declaro" (sentido identidad) disparaba
// el patrón fiscal. #13: CITY capturaba "estoy en X" no-locativo creando un hecho falso de ciudad.

describe("#5 impuestos: solo el sentido FISCAL defiere; el reflexivo de identidad ya NO pisa lo cubierto", () => {
  it("preguntas FISCALES siguen difiriendo a Alex (asks-unknown)", () => {
    expect(classifyCallSignal({ utterance: "¿hay que declarar los impuestos?" })).toBe("asks-unknown");
    expect(classifyCallSignal({ utterance: "¿quién lo declara?" })).toBe("asks-unknown");
    expect(classifyCallSignal({ utterance: "¿lo tengo que declarar yo?" })).toBe("asks-unknown");
    expect(classifyCallSignal({ utterance: "¿y la declaración cómo va?" })).toBe("asks-unknown");
  });

  it("el reflexivo de IDENTIDAD ya NO fuerza defer: si el retriever lo cubre, responde (asks-covered)", () => {
    expect(classifyCallSignal({ utterance: "¿tengo que declararme como creadora?", isCoveredQuestion: true })).toBe(
      "asks-covered"
    );
    expect(classifyCallSignal({ utterance: "si me declaro, ¿se sabe quién soy?", isCoveredQuestion: true })).toBe("asks-covered");
  });
});

describe("#13 ciudad: 'estoy en X' no-locativo ya NO crea un hecho de ciudad falso", () => {
  it("actividades/lugares con determinante o comunes NO son ciudad", () => {
    for (const u of ["estoy en una reunión", "estoy en el trabajo", "estoy en clase", "estoy en casa", "estoy en la ducha"]) {
      expect(extractCallFacts([u]).join(" "), u).not.toMatch(/está en|es de/i);
    }
  });
  it("las ciudades de verdad se siguen recordando", () => {
    expect(extractCallFacts(["soy de córdoba"]).join(" ")).toMatch(/cordoba/);
    expect(extractCallFacts(["vivo en buenos aires"]).join(" ")).toMatch(/buenos aires/);
    expect(extractCallFacts(["estoy en rosario"]).join(" ")).toMatch(/rosario/);
  });
});
