import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";

const sig = (utterance: string, isCoveredQuestion?: boolean) => classifyCallSignal({ utterance, isCoveredQuestion });
const sigMoney = (utterance: string) => classifyCallSignal({ utterance, moneyContext: true });

describe("clasificador de señal de la llamada", () => {
  it("agresión / acusación directa -> hostile-or-suspicious", () => {
    expect(sig("esto es una estafa, sois unos ladrones")).toBe("hostile-or-suspicious");
    expect(sig("eres imbécil")).toBe("hostile-or-suspicious");
  });

  it("pide hablar con una persona -> wants-human", () => {
    expect(sig("quiero hablar con una persona")).toBe("wants-human");
    expect(sig("prefiero no hablar con un bot")).toBe("wants-human");
    expect(sig("¿me pasas con Alex?")).toBe("wants-human");
  });

  it("pide humano de forma INDIRECTA o LATAM -> wants-human (escalar antes)", () => {
    expect(sig("prefiero que me explique esto una persona")).toBe("wants-human");
    expect(sig("¿no me puede comunicar con el señor Alex?")).toBe("wants-human");
    expect(sig("quiero platicar con un humano, no con la grabación")).toBe("wants-human");
    expect(sig("me comunican con el responsable porfa")).toBe("wants-human");
    // No confundir con desconfianza ni con una referencia pasada a una persona:
    expect(sig("una persona me dijo que esto era bueno")).not.toBe("wants-human");
  });

  it("queja del reparto (término de % + término de queja) -> complains-about-share", () => {
    expect(sig("el 30% es mucho")).toBe("complains-about-share");
    expect(sig("¿no podéis bajar la comisión?")).toBe("complains-about-share");
    expect(sig("os quedáis demasiado")).toBe("complains-about-share");
  });

  it("asentimiento a secas con '?' ('si?', 'vale?') -> follows-along, NO deferir (bug sim voz 7-jul)", () => {
    // A un "si?" al descolgar el bot defieria algo inexistente ("te lo confirmo por WhatsApp"): mal, es "si, dime".
    expect(sig("si?")).toBe("follows-along");
    expect(sig("vale?")).toBe("follows-along");
    expect(sig("ah si?")).toBe("follows-along");
    expect(sig("claro?")).toBe("follows-along");
    expect(sig("si si?")).toBe("follows-along");
    expect(sig("si?")).not.toBe("asks-unknown");
    // Control: un asentimiento SEGUIDO de una pregunta real NO se traga -> sigue siendo pregunta.
    expect(sig("vale pero eso como funciona?")).not.toBe("follows-along");
    expect(sig("si pero de donde sois?")).toBe("asks-identity");
    // BLINDAJE de los invariantes mas sensibles (el asentimiento delante NO puede pisar seguridad/negociacion):
    expect(sig("si, tengo 16")).toBe("underage"); // invariante 2: el "si" no tapa la minoria de edad
    expect(sigMoney("si, sigue siendo mucho")).toBe("complains-about-share"); // inv. 3: no regala un escalon
  });

  it("insistencia vaga en dinero ('dar un poco mas') sigue la escalera SOLO en negociacion (bug sim voz 7-jul)", () => {
    // Tras bajar a 65, un "un poco mas" debe contar como seguir insistiendo (queja), no deferir. Decision de
    // Alex: negociacion progresiva, 60 es el suelo y solo si insiste mucho.
    expect(sigMoney("no me podeis dar un poco mas?")).toBe("complains-about-share");
    expect(sigMoney("dame un poco mas")).toBe("complains-about-share");
    expect(sigMoney("y no podeis dar algo mas?")).toBe("complains-about-share");
    // Con coletilla de cortesia (habitual por voz): sigue contando como insistencia.
    expect(sigMoney("dame un poco mas porfa")).toBe("complains-about-share");
    expect(sigMoney("no me podeis dar un poco mas por favor?")).toBe("complains-about-share");
    // Pero "mas X" con coletilla NO se cuela (el sustantivo sigue vetando).
    expect(sigMoney("dame mas ejemplos porfa")).not.toBe("complains-about-share");
    // NEGATIVOS (NO regalar un escalon: "mas" debe ser el objeto de "dar" SIN sustantivo detras). Estos, con
    // "mas X", NO son quejas de reparto aunque haya moneyContext (bloqueante del revisor 7-jul):
    expect(sigMoney("cuentame un poco mas")).not.toBe("complains-about-share"); // pide INFO, no dinero
    expect(sigMoney("dame mas tiempo")).not.toBe("complains-about-share");
    expect(sigMoney("dame mas ejemplos")).not.toBe("complains-about-share");
    expect(sigMoney("me puedes dar mas ejemplos de chicas?")).not.toBe("complains-about-share");
    expect(sigMoney("dame mas fotos")).not.toBe("complains-about-share");
    expect(sigMoney("dame mas trabajo")).not.toBe("complains-about-share");
    expect(sigMoney("me dais mas flexibilidad?")).not.toBe("complains-about-share");
    expect(sigMoney("dame un dia mas")).not.toBe("complains-about-share");
    expect(sig("me podeis dar un poco mas?")).not.toBe("complains-about-share"); // fuera de negociacion, no cuenta
  });

  it("desconfianza leve (worried) -> distrust, no hostil", () => {
    expect(sig("¿cómo sé que esto es real?")).toBe("distrust");
    expect(sig("no me fío")).toBe("distrust");
    expect(sig("¿no será una estafa?")).toBe("distrust");
    expect(sig("me da un poco de miedo")).toBe("distrust");
  });

  it("quiere terminar -> wants-to-end", () => {
    expect(sig("te dejo que tengo prisa")).toBe("wants-to-end");
    expect(sig("ahora no puedo, hablamos luego")).toBe("wants-to-end");
  });

  it("pregunta: cubierta -> asks-covered, desconocida (defecto) -> asks-unknown", () => {
    expect(sig("¿cómo funciona?", true)).toBe("asks-covered");
    expect(sig("¿cómo funciona?", false)).toBe("asks-unknown");
    // Sin pista del recuperador, una pregunta se defiere a Alex (nunca se improvisa).
    expect(sig("¿y los impuestos?")).toBe("asks-unknown");
  });

  it("asentimiento -> follows-along", () => {
    expect(sig("vale, perfecto")).toBe("follows-along");
    expect(sig("sí, cuéntame")).toBe("follows-along");
  });

  it("vacío / silencio -> unclear (no se asume asentimiento)", () => {
    expect(sig("")).toBe("unclear");
    expect(sig("   ")).toBe("unclear");
  });

  it("desinterés -> not-interested", () => {
    expect(sig("no me interesa")).toBe("not-interested");
    expect(sig("no gracias, así no")).toBe("not-interested");
    expect(sig("mejor lo dejamos")).toBe("not-interested");
  });

  it("ruido / frase no reconocida -> unclear (pedir que repita)", () => {
    expect(sig("ajksdhf qwe")).toBe("unclear");
    expect(sig("mmm ehh")).toBe("unclear");
  });

  it("prioridad: pedir persona gana a la queja del reparto", () => {
    expect(sig("quiero hablar con una persona sobre la comisión que es mucho")).toBe("wants-human");
  });

  it("prioridad: la desconfianza se evalúa antes que la pregunta genérica", () => {
    expect(sig("¿esto es seguro? me da miedo")).toBe("distrust");
  });
});

// Regresión de la auditoría (16-jun): falsos negativos de escalado y de queja del reparto.
describe("clasificador: robustez (auditoría)", () => {
  it("insultos/agresión coloquial escalan a hostile", () => {
    expect(sig("no me jodas")).toBe("hostile-or-suspicious");
    expect(sig("qué mierda me estás contando")).toBe("hostile-or-suspicious");
    expect(sig("déjate de gilipolleces")).toBe("hostile-or-suspicious");
    expect(sig("menuda estafa de mierda")).toBe("hostile-or-suspicious");
    expect(sig("esto huele a estafa")).toBe("hostile-or-suspicious");
  });

  it("hostilidad en 3ª persona (LATAM) escala", () => {
    expect(sig("son unos ladrones")).toBe("hostile-or-suspicious");
    expect(sig("me están engañando")).toBe("hostile-or-suspicious");
  });

  it("peticiones de persona en fraseo natural/LATAM escalan a wants-human", () => {
    expect(sig("me gustaría hablar con el responsable")).toBe("wants-human");
    expect(sig("que me llame alguien")).toBe("wants-human");
    expect(sig("me puede atender una persona")).toBe("wants-human");
    expect(sig("no me hables tú, que se ponga una persona")).toBe("wants-human");
  });

  it("quejas del reparto con otras palabras se detectan", () => {
    expect(sig("el 30% me parece una barbaridad")).toBe("complains-about-share");
    expect(sig("el 30 me parece excesivo")).toBe("complains-about-share");
    expect(sig("¿podéis quedaros con menos?")).toBe("complains-about-share");
  });

  it("queja de SEGUIMIENTO en negociación (frase dirigida al dinero) cuenta como queja", () => {
    expect(sigMoney("sigue siendo mucho, bajadlo")).toBe("complains-about-share");
    expect(sigMoney("no me compensa")).toBe("complains-about-share");
    expect(sigMoney("es mucha comisión")).toBe("complains-about-share");
    // Sin contexto de dinero, una queja suelta NO se interpreta como queja del reparto.
    expect(sig("sigue siendo mucho")).not.toBe("complains-about-share");
  });

  it("en negociación, quejas sobre CONTENIDO/ritmo NO se confunden con queja del reparto (no regala margen)", () => {
    expect(sigMoney("es mucho contenido para empezar")).not.toBe("complains-about-share");
    expect(sigMoney("necesito reducir el ritmo de subidas")).not.toBe("complains-about-share");
    expect(sigMoney("aún así me interesa, seguimos")).not.toBe("complains-about-share");
  });

  it("sospecha HIPOTÉTICA ('y si es una estafa') es distrust, no hostil; interjección positiva no escala", () => {
    expect(sig("¿y si es una estafa?")).toBe("distrust");
    expect(sig("joder qué bien suena")).not.toBe("hostile-or-suspicious");
  });

  it("desconfianza expresada como pregunta -> distrust (no defiere)", () => {
    expect(sig("¿y cómo sé que me vais a pagar?")).toBe("distrust");
    expect(sig("¿esto no será una mentira?")).toBe("distrust");
    expect(sig("no me lo creo mucho")).toBe("distrust");
  });

  it("conformidad con palabra interrogativa -> follows-along, no pregunta", () => {
    expect(sig("como tú digas")).toBe("follows-along");
    expect(sig("lo que tú veas")).toBe("follows-along");
  });

  it("muletillas de 'continúa' (¿y?, ¿qué más?, sigue) avanzan, no se defieren", () => {
    expect(sig("¿y?")).toBe("follows-along");
    expect(sig("¿y qué más?")).toBe("follows-along");
    expect(sig("¿qué más?")).toBe("follows-along");
    expect(sig("sigue, sigue")).toBe("follows-along");
    expect(sig("vale, ¿y luego?")).toBe("follows-along");
  });
});
