import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// FASE 3 (23-jul, "menos plantillas"): la DEFENSA del 70 la redacta luna (misma sustancia de Alex, otra piel
// en cada llamada). La red: solo cifras autorizadas en la dirección correcta; cualquier concesión/cifra
// nueva/inversión del draft cae al texto de Alex de siempre. La DECISIÓN de defender sigue siendo del código.

const sys: CallChatMessage = { role: "system", content: "p" };
const CONVO: CallChatMessage[] = [
  sys,
  { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" },
  { role: "user", content: "¿cuánto os lleváis vosotros exactamente?" },
  { role: "assistant", content: "el reparto es un 30% para ti y un 70% para la agencia..." },
  { role: "user", content: "mmm, pero el 70% para vosotros es demasiado, y eso, los 30, no me gustó" } // fraseo real de Alba
];

describe("DEFEND_SHARE redactado por luna con red determinista", () => {
  it("un draft natural y seguro (puede citar el 70/30 autorizado) SE USA", async () => {
    const natural =
      "Mira, lo entiendo, pero ese 70% no me lo quedo yo: paga las cuentas, la publicidad y al equipo que vende por ti a todas horas; tú no pones un euro.";
    const res = await respondToCall({ messages: CONVO, drafter: { draft: async () => natural } });
    expect(res.directiveType).toBe("DEFEND_SHARE");
    expect(res.content).toBe(natural);
  });

  it("si el draft OFRECE otra cifra (45%), cae al texto de Alex (la concesión la decide el código)", async () => {
    const res = await respondToCall({
      messages: CONVO,
      drafter: { draft: async () => "Bueno, te lo puedo dejar en un 45% para ti y cerramos, ¿vale?" }
    });
    expect(res.directiveType).toBe("DEFEND_SHARE");
    expect(res.content).not.toContain("45");
    expect(res.content).toContain("setenta"); // el fallback de Alex
  });

  it("si el draft INVIERTE el reparto ('te quedas el 70'), cae al fallback", async () => {
    const res = await respondToCall({
      messages: CONVO,
      drafter: { draft: async () => "Tranquila, tú te quedas con el 70% y nosotros el 30%." }
    });
    expect(res.content).not.toMatch(/te quedas con el 70/i);
    expect(res.content).toContain("setenta");
  });

  it("sin redactor, el texto determinista de Alex de siempre (cero regresión)", async () => {
    const res = await respondToCall({ messages: CONVO });
    expect(res.directiveType).toBe("DEFEND_SHARE");
    expect(res.content).toContain("setenta");
  });
});

// Pasada adversarial inline (24-jul, revisor caído por límite): 2 huecos cerrados con sonda ejecutable.
describe("huecos de la pasada adversarial", () => {
  it("una CONCESIÓN BLANDA sin cifra del draft ('te lo puedo mejorar') cae al fallback", async () => {
    const res = await respondToCall({
      messages: CONVO,
      drafter: { draft: async () => "Bueno, mira, si te comprometes te lo puedo mejorar un poco más adelante, ¿vale?" }
    });
    expect(res.content).not.toMatch(/mejorar/i);
    expect(res.content).toContain("setenta"); // fallback de Alex: defiende sin prometer mejoras
  });

  it("'porfa algo más de tiempo' en moneyContext NO es queja del reparto (no regala escalón)", async () => {
    const { classifyCallSignal } = await import("@/application/callSignalClassifier");
    expect(classifyCallSignal({ utterance: "porfa algo más de tiempo para verlo", moneyContext: true })).not.toBe(
      "complains-about-share"
    );
    expect(classifyCallSignal({ utterance: "aunque sea un poquito más de tiempo", moneyContext: true })).not.toBe(
      "complains-about-share"
    );
  });
});
