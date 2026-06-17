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
});
