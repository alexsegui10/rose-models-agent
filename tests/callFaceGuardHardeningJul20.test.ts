import { describe, expect, it } from "vitest";
import { promisesFaceConcealment } from "@/application/faceConcealment";
import { planCallUtterance } from "@/application/callRedaction";
import { validateCallUtterance } from "@/application/callRedactionValidator";

// Barrido adversarial de voz 20-jul (lente CARA): el guard COMPARTIDO tenía huecos por los que un draft
// acomodaticio del LLM prometía trabajar sin cara. Se cierran SIN romper la insistencia legítima (que dice
// que la cara es imprescindible). Como el guard es compartido texto+voz, este test blinda ambos lados.

describe("promisesFaceConcealment: huecos cerrados (20-jul) — DEBE cazar", () => {
  const DEBE_CAZAR = [
    // #8 subjuntivo "distinga" (antes solo cazaba el indicativo "distingue")
    "tranquila, que no se distinga tu cara y listo",
    // #9 sinónimos de difuminar/ocultar imagen que faltaban
    "te desenfocamos la cara y ya",
    "te ponemos un blur en la cara",
    "trabajás con un avatar en vez de tu cara",
    "así no se te aprecia la cara",
    "casi no se percibe tu cara",
    // #14 "solo cuerpo" sin artículo + coloquial "careto"
    "puedes salir solo cuerpo, sin la cabeza",
    "que no se te vea el careto",
    // H — CONCESIÓN acomodaticia (lo que redactaba el LLM y se colaba)
    "genial, apuntado lo de la cara, sin problema",
    "sin cara, sin problema, tú tranquila",
    "vale, sin la cara no hay problema",
    "lo de la cara sin drama, seguimos con lo demás",
    "respeto que no quieras mostrar la cara",
    // ya cazados por F (control de que siguen cazándose con el FACE ampliado)
    "podemos hacerlo sin enseñar la cara"
  ];
  for (const t of DEBE_CAZAR) {
    it(`caza: "${t}"`, () => {
      expect(promisesFaceConcealment(t)).toBe(true);
      expect(validateCallUtterance(t).valid).toBe(false);
    });
  }
});

describe("promisesFaceConcealment: NO debe tener falsos positivos sobre la INSISTENCIA legítima", () => {
  const NO_DEBE_CAZAR = [
    "la cara es imprescindible, es la base de que esto funcione",
    "sin la cara esto no funciona igual, es lo que da confianza",
    "entiendo que te dé corte enseñar la cara al principio, pero es lo que le da confianza al cliente",
    "la cara ayuda mucho a generar confianza y a atraer tráfico",
    "no te preocupes, vamos paso a paso; la cara es la base de que funcione",
    // concesiones genéricas SIN mención de no-cara (no deben cazar: hace falta las dos cosas)
    "de acuerdo, entonces te cuento cómo trabajamos",
    "sin problema, seguimos con el reparto",
    "apuntado, y ahora te explico lo del contenido",
    // afirmación positiva de la cara con una concesión cerca (no es no-cara)
    "de acuerdo, pero la cara es imprescindible para que esto tire",
    "vale, y la cara la vemos con calma, es importante mostrarla",
    // REGRESIÓN cazada por el revisor 20-jul: "de acuerdo" + "pero" + refuerzo = INSISTENCIA, no concesión
    "de acuerdo, pero lo de la cara es imprescindible",
    "de acuerdo, pero sin la cara esto no funciona",
    "vale, de acuerdo, pero lo de la cara es innegociable"
  ];
  for (const t of NO_DEBE_CAZAR) {
    it(`NO caza: "${t}"`, () => {
      expect(promisesFaceConcealment(t)).toBe(false);
    });
  }

  it("las 7 variantes RECONDUCT_FACE (deterministas, insisten en la cara) siguen pasando el validador", () => {
    for (let i = 0; i < 7; i += 1) {
      const plan = planCallUtterance({ directive: { type: "RECONDUCT_FACE" }, repetitionIndex: i } as never);
      const text = plan.deterministicText ?? plan.fallbackText ?? "";
      expect(promisesFaceConcealment(text), `variante ${i}: ${text}`).toBe(false);
      expect(validateCallUtterance(text).valid, `variante ${i}: ${text}`).toBe(true);
    }
  });
});
