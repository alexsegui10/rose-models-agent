import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

const sys: CallChatMessage = { role: "system", content: "prompt del agente" };

describe("responder de turno de llamada (stateless por replay)", () => {
  it("sin turnos de la candidata: abre con la locución legal (declara IA)", () => {
    const res = respondToCall({ messages: [sys] });
    expect(res.directiveType).toBe("GIVE_DISCLOSURE");
    expect(res.content.toLowerCase()).toContain("automatizado");
  });

  it("tras la apertura, un 'vale' avanza a la primera etapa", () => {
    const res = respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "vale, cuéntame" }]
    });
    expect(res.directiveType).toBe("COVER_STAGE");
  });

  it("reproduce el estado: varios 'vale' acaban cerrando con el contrato", () => {
    const messages: CallChatMessage[] = [sys, { role: "assistant", content: "apertura..." }];
    for (let i = 0; i < 8; i++) {
      messages.push({ role: "user", content: "vale" });
      messages.push({ role: "assistant", content: "..." });
    }
    const res = respondToCall({ messages });
    expect(res.content.toLowerCase()).toContain("contrato");
  });

  it("una pregunta directa se defiere a Alex (no improvisa)", () => {
    const res = respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "¿y los impuestos?" }]
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
    expect(res.content).toContain("socio");
  });

  it("pedir hablar con una persona se mantiene en handoff aunque siga hablando", () => {
    const messages: CallChatMessage[] = [
      sys,
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "quiero hablar con una persona" },
      { role: "assistant", content: "te paso con Alex..." },
      { role: "user", content: "vale gracias" }
    ];
    const res = respondToCall({ messages });
    expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
  });

  it("el contenido nunca está vacío (el bot nunca se queda mudo)", () => {
    const res = respondToCall({ messages: [sys, { role: "user", content: "ajksdhf qwe" }] });
    expect(res.content.trim().length).toBeGreaterThan(0);
  });

  it("si la candidata habla PRIMERO (el bot aún no habló), abre con la locución legal", () => {
    const res = respondToCall({ messages: [sys, { role: "user", content: "hola buenas" }] });
    expect(res.directiveType).toBe("GIVE_DISCLOSURE");
    expect(res.content.toLowerCase()).toContain("automatizado");
  });

  it("negociación reconstruida por replay: queja de seguimiento baja a 65 aunque no repita 'reparto'", () => {
    const messages: CallChatMessage[] = [
      sys,
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "el 30% es mucho" }, // presenta 70/30 (cubre MONEY)
      { role: "assistant", content: "te cuento el reparto..." },
      { role: "user", content: "sigue siendo mucho" }, // defiende el 70 una vez
      { role: "assistant", content: "el 70 es para ti..." },
      { role: "user", content: "bajadlo, no me compensa" } // queja de seguimiento -> baja a 65
    ];
    const res = respondToCall({ messages });
    expect(res.directiveType).toBe("CONCEDE_SHARE");
    expect(res.content).toContain("65");
  });
});
