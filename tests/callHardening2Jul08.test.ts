import { describe, it, expect } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallUnderstander, CallUnderstandRequest, CallUnderstoodIntent } from "@/application/callUnderstander";

// Lote 2 del endurecimiento (decisiones de Alex 8-jul): pregunta vaga de dinero -> presentar el reparto;
// objecion de tiempo -> responder el tiempo real; "y eso pa que" -> aclarar lo ultimo dicho.

const sig = (utterance: string, extra: Parameters<typeof classifyCallSignal>[0] = { utterance }) =>
  classifyCallSignal({ ...extra, utterance });

describe("A. Pregunta VAGA de dinero -> asks-share-figure (presenta el reparto; Alex decidio)", () => {
  for (const phrase of [
    "y del dinero como va la cosa",
    "y el dinero como funciona",
    "oye y el pago como va",
    "y el dinero?",
    "como va lo del dinero"
  ]) {
    it(`"${phrase}" -> asks-share-figure`, () => {
      expect(sig(phrase)).toBe("asks-share-figure");
    });
  }

  it("NO rompe: 'cuanto se gana' sigue siendo ingresos (sin cifra)", () => {
    expect(sig("cuanto se gana")).toBe("asks-earnings");
    expect(sig("se gana bien?")).toBe("asks-earnings");
  });

  it("NO rompe: una QUEJA del dinero sigue siendo complains-about-share", () => {
    expect(sig("el dinero es muy poco", { utterance: "x", moneyContext: true })).not.toBe("asks-share-figure");
    expect(sig("30 para mi es poco")).toBe("complains-about-share");
  });

  it("INVARIANTE 3: una AFIRMACION positiva de dinero NO presenta el reparto (no revela % proactivo)", () => {
    // El revisor cazo dos rondas de fugas: "viene"/"como" sueltos, y "como va/funciona" + cola evaluativa
    // de conformidad. Todas deben dar cualquier cosa MENOS asks-share-figure (no soltar el 70/30 sin pedir).
    for (const phrase of [
      "el dinero me viene bien",
      "el dinero me viene de lujo",
      "el dinero viene bien para mi",
      "lo del dinero me viene perfecto",
      "el pago como quieras",
      "el pago como sea me sirve",
      "el cobro como venga bien",
      "la plata como va bien",
      "el pago como va tranquilo",
      "el cobro como va me parece bien",
      "el dinero como va todo bien por mi",
      "el pago como marcha no me importa",
      "el dinero como funciona esta bien asi",
      "el dinero como va no me importa",
      "la plata como marcha genial",
      "el pago como se maneja aqui todo ok",
      "mira el dinero como va no me preocupa mucho",
      "lo del dinero como va perfecto para mi"
    ]) {
      expect(sig(phrase)).not.toBe("asks-share-figure");
    }
  });
});

describe("D. 'y eso pa/para que' retrospectivo -> asks-clarification (no deferir)", () => {
  const lastBotUtterance = "y al pasar los 30 dias monetizamos tu OnlyFans con el equipo de chatters";

  it("'y eso pa que' (con algo que aclarar) -> asks-clarification", () => {
    expect(sig("y eso pa que", { utterance: "x", lastBotUtterance })).toBe("asks-clarification");
    expect(sig("y eso para que", { utterance: "x", lastBotUtterance })).toBe("asks-clarification");
    expect(sig("pa que es eso", { utterance: "x", lastBotUtterance })).toBe("asks-clarification");
  });

  it("sin nada previo del bot que aclarar, no lo fuerza a clarification", () => {
    expect(sig("y eso pa que")).not.toBe("asks-clarification");
  });
});

// B. Objecion de TIEMPO -> responder el tiempo real (content-time-commitment), no la tranquilizacion
// generica anti-estafa. La comprension mapea "time-concern"; aqui se inyecta un entendedor FAKE.
class FakeUnderstander implements CallUnderstander {
  constructor(private readonly intent: CallUnderstoodIntent | null) {}
  async understand(_request: CallUnderstandRequest): Promise<CallUnderstoodIntent | null> {
    return this.intent;
  }
}

describe("B. time-concern -> responde el tiempo real (compaginable), no anti-estafa generico", () => {
  it("una objecion de tiempo entendida por la comprension responde con el conocimiento del tiempo", async () => {
    const messages: CallChatMessage[] = [
      { role: "assistant", content: "Hola Lucia, soy Alex. Te cuento como trabajamos, ¿vale?" },
      { role: "user", content: "es que trabajo y no se si tendre tiempo para esto" }
    ];
    const res = await respondToCall({
      messages,
      candidateName: "Lucia",
      understander: new FakeUnderstander("time-concern")
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    // Sin redactor, el fallback son los puntos aprobados del tiempo (jornada/compaginar/horas al dia).
    expect(res.content.toLowerCase()).toMatch(/jornada|compagin|horas al dia/);
  });
});
