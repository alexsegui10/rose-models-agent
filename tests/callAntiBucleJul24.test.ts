import { describe, expect, it } from "vitest";
import { decideCallDirective, initialCallDirectorState } from "@/application/callDirector";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { stripTrailingCheckCloser } from "@/application/callTurnResponder";
import type { BusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";

// TANDA 1 (24-jul): 3 bucles reales cazados en barrido — tope de calma, anti-eco y coletilla de reassure.

describe("tope de calma: al 3er turno consecutivo de tranquilizar/acusar, el guion AVANZA", () => {
  const base = { ...initialCallDirectorState(), disclosureGiven: true };
  it("distrust x2 -> REASSURE; el 3º -> avanza (COVER_STAGE)", () => {
    const d1 = decideCallDirective({ state: base, signal: "distrust" });
    expect(d1.directive.type).toBe("REASSURE");
    const d2 = decideCallDirective({ state: d1.nextState, signal: "distrust" });
    expect(d2.directive.type).toBe("REASSURE");
    const d3 = decideCallDirective({ state: d2.nextState, signal: "distrust" });
    expect(d3.directive.type).toBe("COVER_STAGE"); // avanza: valida y sigue, como una persona
  });
  it("acknowledge x2 -> ACKNOWLEDGE; el 3º -> avanza (caso Roxana: 6 seguidos e improvisó)", () => {
    const d1 = decideCallDirective({ state: base, signal: "acknowledge" });
    const d2 = decideCallDirective({ state: d1.nextState, signal: "acknowledge" });
    const d3 = decideCallDirective({ state: d2.nextState, signal: "acknowledge" });
    expect([d1.directive.type, d2.directive.type]).toEqual(["ACKNOWLEDGE", "ACKNOWLEDGE"]);
    expect(d3.directive.type).toBe("COVER_STAGE");
  });
  it("cualquier otra señal REINICIA la racha (no avanza de más)", () => {
    const d1 = decideCallDirective({ state: base, signal: "distrust" });
    const d2 = decideCallDirective({ state: d1.nextState, signal: "asks-covered" }); // corta la racha
    const d3 = decideCallDirective({ state: d2.nextState, signal: "distrust" });
    expect(d3.directive.type).toBe("REASSURE"); // vuelve a empezar, no avanza
  });
});

describe("anti-eco: la MISMA respuesta de conocimiento jamás se repite clavada (caso Sol x3)", () => {
  const entry = businessKnowledgeEntries.find((e) => e.id === "content-agency-responsibilities")!;
  const coveringRetriever: BusinessKnowledgeRetriever = { retrieve: async () => [entry] };
  it("si el fallback repetiría lo último dicho, sale el defer honesto", async () => {
    const answerText = entry.approvedAnswerPoints.join(" ");
    const messages: CallChatMessage[] = [
      { role: "system", content: "p" },
      { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" },
      { role: "user", content: "¿cuánto tráfico meten ustedes posta?" },
      { role: "assistant", content: answerText }, // el bot YA dijo exactamente esto
      { role: "user", content: "sí pero decime concreto cuánto tráfico meten" }
    ];
    const res = await respondToCall({ messages, retriever: coveringRetriever });
    if (res.directiveType === "ANSWER_FROM_KNOWLEDGE") {
      expect(res.content.trim()).not.toBe(answerText.trim()); // jamás el eco literal
      expect(res.content.toLowerCase()).toContain("whatsapp"); // defer honesto
    }
  });
});

describe("la coletilla del reassure se recorta cuando encadena (Romina: 6 veces la misma)", () => {
  it("'¿te quedas más tranquila o te sigue rondando algo?' se recorta", () => {
    expect(stripTrailingCheckCloser("Somos transparentes. ¿Te quedas más tranquila o te sigue rondando algo?")).toBe(
      "Somos transparentes."
    );
    expect(stripTrailingCheckCloser("Vamos paso a paso. ¿Te deja eso más tranquila?")).toBe("Vamos paso a paso.");
    expect(stripTrailingCheckCloser("El dinero pasa primero por ti. ¿Te sigue rondando algo concreto?")).toBe(
      "El dinero pasa primero por ti."
    );
  });
});
