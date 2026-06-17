import { describe, expect, it } from "vitest";
import { validateCallUtterance } from "@/application/callRedactionValidator";

const ok = (t: string) => validateCallUtterance(t).valid;

describe("validador de la redacción de voz", () => {
  it("acepta una frase normal del guion", () => {
    expect(ok("Genial, te resumo cómo trabajamos: tú mandas el contenido y nosotros el resto.")).toBe(true);
  });

  it("acepta los porcentajes autorizados (70/30, 65/35, 60/40)", () => {
    expect(ok("Es un 70% para ti y un 30% para nosotros.")).toBe(true);
    expect(ok("Podemos dejarlo en un 65 para ti y un 35 para nosotros.")).toBe(true);
    expect(ok("Lo dejamos en 60/40.")).toBe(true);
  });

  it("RECHAZA un porcentaje NO autorizado (invariante 3)", () => {
    expect(ok("Te puedo dar un 80% para ti.")).toBe(false);
    expect(ok("Sería un 50/50.")).toBe(false);
  });

  it("RECHAZA promesas o cifras de ingresos", () => {
    expect(ok("Vas a ganar 3000 euros al mes seguro.")).toBe(false);
    expect(ok("Ganarás muchísimo.")).toBe(false);
    expect(ok("Se suelen sacar unos 2000€ mensuales.")).toBe(false);
  });

  it("acepta números legítimos que NO son ni % ni dinero", () => {
    expect(ok("Al principio son unos 5 días con 2 o 3 fotos al día, y luego vídeos.")).toBe(true);
    expect(ok("Se liquida cada 14 días y cobras tú primero.")).toBe(true);
    expect(ok("Un equipo de chatters lo monetiza las 24 horas.")).toBe(true);
  });

  it("rechaza vacío y monólogos demasiado largos", () => {
    expect(ok("")).toBe(false);
    expect(ok("a ".repeat(400))).toBe(false);
  });

  // Regresión de la auditoría: huecos que el LLM podría colar.
  it("RECHAZA porcentajes NO autorizados escritos en PALABRAS", () => {
    expect(ok("Te puedo dar un ochenta por ciento para ti.")).toBe(false);
    expect(ok("Sería el noventa por ciento.")).toBe(false);
    expect(ok("Lo dejamos a medias, fifty fifty.")).toBe(false);
  });

  it("acepta los porcentajes autorizados en PALABRAS", () => {
    expect(ok("Es un setenta por ciento para ti.")).toBe(true);
    expect(ok("Podemos dejarlo en un sesenta y cinco por ciento.")).toBe(true);
  });

  it("RECHAZA promesas de ingresos sin cifra ni símbolo", () => {
    expect(ok("Aquí se gana muy bien, de verdad.")).toBe(false);
    expect(ok("Con esto te vas a forrar.")).toBe(false);
    expect(ok("Son ingresos asegurados.")).toBe(false);
    expect(ok("Vas a ganar mucho dinero.")).toBe(false);
    expect(ok("Es dinero fácil.")).toBe(false);
  });

  it("RECHAZA cifras de ingreso periódico en orden natural ('3000 al mes', 'tres mil al mes')", () => {
    expect(ok("Sacas 3000 al mes tranquilamente.")).toBe(false);
    expect(ok("Son tres mil al mes seguros.")).toBe(false);
  });

  it("no se pasa de celoso: frases benignas con 'asegurar/ganar' no relacionadas con dinero pasan", () => {
    expect(ok("Te aseguro que somos una agencia seria y vamos paso a paso.")).toBe(true);
    expect(ok("Así ganas más visibilidad en Instagram.")).toBe(true);
  });
});
