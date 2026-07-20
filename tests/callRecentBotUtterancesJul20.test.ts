import { describe, expect, it } from "vitest";
import { buildDraftPrompt } from "@/application/openaiCallDrafter";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallDraftRequest } from "@/application/callDrafter";

// Barrido realista 20-jul (Camila/Priscila): cuando ella re-pregunta, el bot repetía casi clavada la misma
// respuesta porque NO veía lo que él mismo acababa de decir. Ahora el redactor recibe sus últimos turnos con
// el aviso de NO repetir (referenciar / avanzar). Vía IA (nudge al prompt), no regex.

describe("anti-repetición: el redactor recibe lo que él YA dijo (20-jul)", () => {
  it("buildDraftPrompt incluye los turnos previos del bot + el aviso de no repetir", () => {
    const p = buildDraftPrompt({
      brief: {
        instruction: "Responde.",
        groundingFacts: [],
        prohibitedClaims: [],
        mandatoryNuances: [],
        referenceInstagram: false,
        recentBotUtterances: ["La cara es imprescindible para generar confianza."]
      } as never,
      directiveType: "ANSWER_FROM_KNOWLEDGE"
    });
    expect(p).toContain("LO QUE TÚ YA HAS DICHO");
    expect(p).toContain("NO lo repitas");
    expect(p).toContain("La cara es imprescindible para generar confianza.");
  });

  it("sin turnos previos del bot, NO añade la sección (apertura)", () => {
    const p = buildDraftPrompt({
      brief: {
        instruction: "Saluda.",
        groundingFacts: [],
        prohibitedClaims: [],
        mandatoryNuances: [],
        referenceInstagram: false
      } as never,
      directiveType: "COVER_STAGE"
    });
    expect(p).not.toContain("LO QUE TÚ YA HAS DICHO");
  });

  it("respondToCall pasa al redactor los ÚLTIMOS 2 turnos del bot (no más)", async () => {
    let captured: CallDraftRequest | undefined;
    const drafter = {
      draft: async (req: CallDraftRequest) => {
        captured = req;
        return "algo natural, ¿vale?";
      }
    };
    const messages: CallChatMessage[] = [
      { role: "system", content: "prompt" },
      { role: "assistant", content: "PRIMER turno del bot." },
      { role: "user", content: "vale" },
      { role: "assistant", content: "SEGUNDO turno del bot." },
      { role: "user", content: "sigue, cuéntame más" }
    ];
    await respondToCall({ messages, drafter });
    const recent = captured?.brief.recentBotUtterances ?? [];
    expect(recent).toContain("SEGUNDO turno del bot.");
    expect(recent.length).toBeLessThanOrEqual(2);
  });
});
