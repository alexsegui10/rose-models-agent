import { describe, expect, it } from "vitest";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// Endurecimiento del validador (workflow 10-lentes 20-jul + revisor 23-jul): 3 huecos de la última línea
// de defensa, cerrados SIN falsos positivos sobre los textos legítimos (la suite valida todos los pools).

describe("inversión del reparto PARAFRASEADA: jamás pasa", () => {
  const INVALIDAS = [
    "Y lo mejor: tú te quedas con el 70% y nosotros con el 30%",
    "el 70 lo cobras vos y nosotros el 30",
    "te llevas el setenta por ciento y la agencia el treinta",
    "es tuyo el 70, de verdad",
    "tu parte es el 70% de todo",
    "nosotros nos quedamos el 30 y listo"
  ];
  for (const t of INVALIDAS) {
    it(`inválida: "${t}"`, () => {
      expect(validateCallUtterance(t, undefined, { allowAuthorizedShare: true }).valid).toBe(false);
    });
  }
  const LEGITIMAS = [
    "El reparto es un 30% para ti y un 70% para la agencia.",
    "Tú te quedas con el 30% y la agencia con el 70%.",
    "Lo dejamos en un 35% para ti y un 65% para nosotros, ¿vale?",
    "Un 70% para la agencia, porque ponemos todo; y el dinero lo cobras tú directamente en tu cuenta."
  ];
  for (const t of LEGITIMAS) {
    it(`legítima: "${t}"`, () => {
      expect(validateCallUtterance(t, undefined, { allowAuthorizedShare: true }).valid).toBe(true);
    });
  }
});

describe("cifra de dinero EN LETRA: inválida en CUALQUIER turno (no solo ingresos)", () => {
  it("'quinientos euros al mes' cae aunque sea un turno de reassure/etapa", () => {
    expect(validateCallUtterance("tranquila, te aseguro quinientos euros al mes").valid).toBe(false);
    expect(validateCallUtterance("algunas sacan dos mil pesos por semana").valid).toBe(false);
    expect(validateCallUtterance("unas quinientas lucas fáciles").valid).toBe(false);
  });
  it("no rompe habla legítima sin moneda", () => {
    expect(validateCallUtterance("cobras cada catorce dias, tranquila").valid).toBe(true);
    expect(validateCallUtterance("son dos o tres fotos al dia los primeros cinco dias").valid).toBe(true);
  });
});

describe("turno de DINERO: números de 3+ dígitos jamás", () => {
  it("'entre 1000 y 3000' cae en el turno del reparto", () => {
    expect(
      validateCallUtterance("el reparto es un 30% para ti, y algunas sacan entre 1000 y 3000", undefined, {
        allowAuthorizedShare: true
      }).valid
    ).toBe(false);
  });
  it("el texto legítimo del reparto (cifras de 2 dígitos + 14 días) sigue pasando", () => {
    expect(
      validateCallUtterance("Es un 30% para ti y un 70% para la agencia, y cobras cada 14 dias.", undefined, {
        allowAuthorizedShare: true
      }).valid
    ).toBe(true);
  });
});
