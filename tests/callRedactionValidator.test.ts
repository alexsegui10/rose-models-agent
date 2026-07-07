import { describe, expect, it } from "vitest";
import { validateCallUtterance } from "@/application/callRedactionValidator";

const ok = (t: string) => validateCallUtterance(t).valid;

describe("validador de la redacción de voz", () => {
  it("acepta una frase normal del guion", () => {
    expect(ok("Genial, te resumo cómo trabajamos: tú mandas el contenido y nosotros el resto.")).toBe(true);
  });

  // jul-2026 (R1): las frases legítimas van en la DIRECCIÓN REAL del reparto (la parte pequeña para
  // ella). Las antiguas ("70% para ti") codificaban la INVERSIÓN que Alex arregló en junio; ahora esa
  // inversión se RECHAZA aunque las cifras sean autorizadas (test más abajo).
  it("acepta los porcentajes autorizados en la dirección correcta (30/35/40 para ella)", () => {
    expect(ok("Es un 30% para ti y un 70% para nosotros.")).toBe(true);
    expect(ok("Podemos dejarlo en un 35 para ti y un 65 para nosotros.")).toBe(true);
    expect(ok("Lo dejamos en 60/40.")).toBe(true);
  });

  it("RECHAZA la inversión del reparto aunque las cifras sean autorizadas (R1)", () => {
    expect(ok("Es un 70% para ti y un 30% para nosotros.")).toBe(false);
    expect(ok("Ese setenta por ciento es para ti.")).toBe(false);
    expect(ok("Solo nos quedamos un 30% para la agencia.")).toBe(false);
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

  it("turno de INGRESOS (noMoneyFigures): rechaza CUALQUIER cifra que el LLM pudiera colar vendiendo 'cuánto se gana'", () => {
    // Huecos del eje de ingresos que se colaban con las reglas normales (revisor 7-jul): numero desnudo,
    // 'al dia', slang. En un turno de ingresos NINGUN numero es legitimo -> barrera absoluta.
    const earn = (t: string) => validateCallUtterance(t, undefined, { noMoneyFigures: true }).valid;
    expect(earn("Hay chicas que ganan entre 1000 y 3000.")).toBe(false);
    expect(earn("Puedes llegar a 5000.")).toBe(false);
    expect(earn("Algunas hacen 100 al dia.")).toBe(false);
    expect(earn("Unos 40 al dia sin problema.")).toBe(false);
    expect(earn("Unos 50 pavos al dia.")).toBe(false);
    expect(earn("Se sacan dos mil al mes.")).toBe(false);
    // Numerales en PALABRAS (decenas/unidades), que las reglas normales no cazaban (revisor 7-jul):
    expect(earn("Unos cuarenta al dia facil.")).toBe(false);
    expect(earn("Como cincuenta pavos al dia.")).toBe(false);
    expect(earn("Unos veinte al dia para empezar.")).toBe(false);
    expect(earn("Facil setenta al dia.")).toBe(false);
    expect(earn("Unos ochenta a la semana.")).toBe(false);
    expect(earn("Como treinta diarios.")).toBe(false);
    expect(earn("Unas quince lucas al mes.")).toBe(false);
    // Unidades/adolescentes/veintitantos en palabras (el ultimo sub-hueco): tambien fuera.
    expect(earn("Como tres al dia.")).toBe(false);
    expect(earn("Nueve al dia tranquilamente.")).toBe(false);
    expect(earn("Unos doce al dia.")).toBe(false);
    expect(earn("Unos dieciocho al dia.")).toBe(false);
    expect(earn("Veintitres al dia.")).toBe(false);
    // "un/una + moneda" (la regla general de moneda exige digito): euro y coloquiales AR (pavo/luca/mango).
    expect(earn("Un euro al dia.")).toBe(false);
    expect(earn("Una luca al mes.")).toBe(false);
    expect(earn("Un pavo al dia.")).toBe(false);
    expect(earn("Unos billetes al dia.")).toBe(false);
    // La respuesta HONESTA de ingresos (sin numeros) SI vale -> el bot la dice. "un/una/uno" NO son cifra:
    // no deben tumbar respuestas buenas (son articulo/pronombre), o el candado iria a menos por sobre-estricto.
    expect(earn("Con sinceridad, depende mucho de ti: de tu constancia y de la calidad del contenido.")).toBe(true);
    expect(earn("Eso depende de ti; no te voy a prometer una cifra porque seria mentirte.")).toBe(true);
    expect(earn("Mira, es un tema de constancia; uno nunca sabe, depende de como le metas.")).toBe(true);
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

  it("acepta los porcentajes autorizados en PALABRAS (dirección correcta)", () => {
    expect(ok("Es un treinta por ciento para ti.")).toBe(true);
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
