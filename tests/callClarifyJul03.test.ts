import { describe, expect, it } from "vitest";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { planCallUtterance } from "@/application/callRedaction";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";

// LOTE 3 (3-jul, llamada real de Alex): "¿qué significa se liquida?" y "¿límite de qué?" acababan en el
// absurdo "te lo confirmo por WhatsApp" — el bot defería SU PROPIO vocabulario. Ahora: señal de
// ACLARACIÓN (solo si el término está en la última frase del bot) -> reformular en simple, jamás socio.

const MONEY_UTTERANCE =
  "Y el dinero: el reparto es un 30% para ti y un 70% para la agencia. Cobras cada 14 días, se liquida quincenal. ¿Qué te parece?";
const LIMITS_UTTERANCE = "¿Hay algún tipo de contenido que no quieras hacer o algún límite que debamos tener en cuenta?";

describe("clasificador: aclaración de lo que el bot ACABA de decir", () => {
  it("'¿qué significa se liquida?' con 'liquida' en la última frase del bot -> asks-clarification", () => {
    expect(classifyCallSignal({ utterance: "¿que significa se liquida?", lastBotUtterance: MONEY_UTTERANCE })).toBe(
      "asks-clarification"
    );
  });

  it("'¿límite de qué?' con 'límite' en la última frase -> asks-clarification", () => {
    expect(classifyCallSignal({ utterance: "¿limite de que?", lastBotUtterance: LIMITS_UTTERANCE })).toBe("asks-clarification");
    expect(classifyCallSignal({ utterance: "¿limites de que?", lastBotUtterance: LIMITS_UTTERANCE })).toBe("asks-clarification");
  });

  it("'¿a qué te refieres?' (sin término) -> aclaración siempre", () => {
    expect(classifyCallSignal({ utterance: "¿a que te refieres?" })).toBe("asks-clarification");
  });

  it("un término que el bot NO dijo sigue el camino normal (no es aclaración)", () => {
    const signal = classifyCallSignal({ utterance: "¿que significa hacienda?", lastBotUtterance: MONEY_UTTERANCE });
    expect(signal).not.toBe("asks-clarification");
  });

  it("sin última frase del bot, '¿qué significa X?' no es aclaración (camino normal)", () => {
    expect(classifyCallSignal({ utterance: "¿que significa se liquida?" })).not.toBe("asks-clarification");
  });

  it("'¿qué decías?' sigue siendo repetición, no aclaración", () => {
    expect(classifyCallSignal({ utterance: "perdona ¿que decias?", lastBotUtterance: MONEY_UTTERANCE })).toBe(
      "asks-bot-to-repeat"
    );
  });
});

describe("director y redacción de la aclaración", () => {
  it("asks-clarification -> CLARIFY_LAST_UTTERANCE sin tocar el estado", () => {
    const opened = decideCallDirective({ state: initialCallDirectorState(), signal: "none" }).nextState;
    const decision = decideCallDirective({ state: opened, signal: "asks-clarification" });
    expect(decision.directive.type).toBe("CLARIFY_LAST_UTTERANCE");
    expect(decision.nextState.coveredStages).toEqual(opened.coveredStages);
  });

  it("el brief prohíbe deferir y añadir datos; el fallback reformula lo último dicho", () => {
    const plan = planCallUtterance({
      directive: { type: "CLARIFY_LAST_UTTERANCE" },
      lastBotUtterance: LIMITS_UTTERANCE,
      utterance: "¿limite de que?"
    });
    expect(plan.draftingBrief).toBeDefined();
    expect(plan.draftingBrief!.prohibitedClaims.join(" ")).toContain("socio");
    expect(plan.draftingBrief!.groundingFacts.join(" ")).toContain("Tu última frase");
    expect(plan.fallbackText).toContain("te lo digo más fácil");
    expect(plan.fallbackText.toLowerCase()).not.toContain("whatsapp");
  });

  it("MENOR cortada que pide aclaración: sigue el gate (repite el corte, sin negocio)", () => {
    const cut = decideCallDirective({ state: initialCallDirectorState(), signal: "underage" }).nextState;
    expect(decideCallDirective({ state: cut, signal: "asks-clarification" }).directive.type).toBe("CLOSE_UNDERAGE");
  });

  it("E2E responder: '¿qué significa se liquida?' NO defiere a WhatsApp (sin drafter usa el fallback)", async () => {
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "vale" },
      { role: "assistant", content: MONEY_UTTERANCE },
      { role: "user", content: "¿que significa se liquida?" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CLARIFY_LAST_UTTERANCE");
    expect(res.content.toLowerCase()).not.toContain("whatsapp");
    expect(res.content.toLowerCase()).not.toContain("socio");
    expect(res.content.trim().length).toBeGreaterThan(0);
  });
});

describe("repetición PARCIAL y eco limpio", () => {
  it("'repíteme lo de onlyfans' -> brief para repetir SOLO esa parte (fallback: eco completo)", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: "Vale...  Claro, mira: tu parte sería crear contenido y lo de OnlyFans te lo mandamos después.",
      utterance: "¿como? repiteme lo de onlyfans"
    });
    expect(plan.draftingBrief).toBeDefined();
    expect(plan.draftingBrief!.instruction).toContain("onlyfans");
    // El eco de respaldo va SIN la muletilla de arranque.
    expect(plan.fallbackText).toContain("Sí, te decía: Claro, mira");
    expect(plan.fallbackText).not.toContain("Vale...");
  });

  it("sin tema concreto, el eco determinista de siempre (sin muletilla anidada)", () => {
    const plan = planCallUtterance({
      directive: { type: "REPEAT_LAST_UTTERANCE" },
      lastBotUtterance: "Muy bien...  Perfecto, Ana, pues arrancaríamos con cinco días de contenido.",
      utterance: "¿que decias?"
    });
    expect(plan.deterministicText).toBe("Sí, te decía: Perfecto, Ana, pues arrancaríamos con cinco días de contenido.");
  });
});

describe("canal de VOZ: los emojis del redactor se eliminan del texto hablado", () => {
  it("un draft con 😄 sale limpio (el TTS no lee emojis)", async () => {
    const drafter = { draft: async () => "Jaja, no te voy a dar mi DNI 😄. Soy Alex, de Rose Models. ¿Seguimos?" };
    const res = await respondToCall({
      messages: [
        { role: "system", content: "p" },
        { role: "assistant", content: "apertura..." },
        { role: "user", content: "vale, cuéntame" }
      ],
      drafter
    });
    expect(res.content).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(res.content).toContain("Soy Alex");
  });
});

describe("lenguaje claro en el dinero: 'cobras', nunca 'se liquida'", () => {
  it("el brief de MONEY prohíbe la jerga 'se liquida' al redactor", () => {
    const plan = planCallUtterance({
      directive: {
        type: "COVER_STAGE",
        stageId: "MONEY",
        shareOffer: { modelShare: 30, agencyShare: 70, step: 0, isFloor: false }
      }
    });
    expect(plan.draftingBrief!.prohibitedClaims.join(" ")).toContain("se liquida");
  });

  it("el fallback de MONEY ya no dice 'se liquida'", () => {
    const plan = planCallUtterance({
      directive: {
        type: "COVER_STAGE",
        stageId: "MONEY",
        shareOffer: { modelShare: 30, agencyShare: 70, step: 0, isFloor: false }
      }
    });
    expect(plan.fallbackText.toLowerCase()).not.toContain("liquida");
    expect(plan.fallbackText).toContain("Cobras cada 14 días");
    expect(plan.draftingBrief!.groundingFacts.join(" ").toLowerCase()).not.toContain("se liquida");
  });
});

describe("transiciones entre secciones (brief del redactor)", () => {
  it("el PRIMER tema pide enmarcar; los siguientes piden anunciar el cambio", () => {
    const first = planCallUtterance({ directive: { type: "COVER_STAGE", stageId: "HOW_AGENCY_WORKS" } });
    expect(first.draftingBrief!.instruction).toContain("PRIMER tema");
    const later = planCallUtterance({
      directive: {
        type: "COVER_STAGE",
        stageId: "MONEY",
        shareOffer: { modelShare: 30, agencyShare: 70, step: 0, isFloor: false }
      },
      coveredTopics: ["Cómo trabaja la agencia", "Qué hace ella"]
    });
    expect(later.draftingBrief!.instruction).toContain("CAMBIANDO DE TEMA");
  });
});
