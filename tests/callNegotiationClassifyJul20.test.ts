import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

// Barrido de negociación dura 20-jul (intuición de Alex): en el SUELO, continuaciones de regateo con fraseo
// variado ("40 me queda corto", "necesito 50", "un puntito medio") se leían como asks-more/unclear y el bot
// AVANZABA en vez de seguir negociando o escalar a Alex. Ahora, EN moneyContext, cuentan como
// complains-about-share (la respuesta sigue siendo la escalera DETERMINISTA: nunca filtra la cifra que pide).
// ADVERSARIAL: la ACEPTACIÓN y las cifras de CONTENIDO NO deben contar como queja.

const sig = (utterance: string) => classifyCallSignal({ utterance, moneyContext: true });

describe("negociación en el suelo: insatisfacción/empuje del % -> complains-about-share (moneyContext)", () => {
  const DEBE = [
    "40 me queda corto",
    "35 me queda cortito che",
    "sigue flojo eso",
    "40 sigue abajo posta",
    "no llegamos a un puntito medio?",
    "partamos la diferencia dale",
    "subime aunque sea a 45",
    "dame 50 y arreglamos",
    "necesito 50, si no no me cierra",
    "mejorame a 45 y cerramos",
    "45 aunque sea, cerramos tranqui",
    "40 aunque sea cerramos tranqui, dale",
    "dale que me convenzas con el %, me queda flojito"
  ];
  for (const u of DEBE) {
    it(`cuenta como queja del reparto: "${u}"`, () => {
      expect(sig(u)).toBe("complains-about-share");
    });
  }
});

describe("ADVERSARIAL: aceptación / contenido / tiempo NO cuentan como queja del reparto", () => {
  const NO_DEBE = [
    "40 está bien, dale", // ACEPTA
    "dale, 40 me sirve", // ACEPTA
    "ok, cerramos en 40", // ACEPTA
    "listo, me quedo con el 40", // ACEPTA
    "grabo 2 o 3 fotos más?", // contenido
    "necesito 5 fotos más para arrancar", // contenido
    "dame un ejemplo de contenido", // contenido, sin cifra
    "un poquito más de tiempo para pensarlo", // tiempo, no %
    // Falsos positivos cazados por el revisor 20-jul (unidades de tiempo + aceptación "N para mí"):
    "dame 48 horas para pensarlo", // TIEMPO (horas), no %
    "necesito 50 horas para decidirme", // TIEMPO
    "dame 45 semanas", // TIEMPO
    "40 para mi ya esta bien", // ACEPTA el suelo
    "el 40 para mi es perfecto", // ACEPTA
    "50 para mi me sirve" // ACEPTA
  ];
  for (const u of NO_DEBE) {
    it(`NO es queja del reparto: "${u}"`, () => {
      expect(sig(u)).not.toBe("complains-about-share");
    });
  }
});
