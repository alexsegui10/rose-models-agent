import { describe, expect, it } from "vitest";
import { acknowledgementFor } from "@/application/conversationEngine";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";

// Decision de Alex (14-jun): el bot no debe ser frio cuando la candidata cuenta algo, pero TAMPOCO
// demasiado emocional, y SOBRE TODO nunca debe inventar nada. El acuse empatico es determinista (frase
// fija, medida): reconoce su situacion sin afirmar ningun hecho ni politica.

function understanding(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "REQUESTS_INFORMATION",
    extractedData: {},
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
}

describe("acknowledgementFor: empatia medida y determinista", () => {
  it("reconoce con empatia cuando la candidata cuenta una dificultad", () => {
    expect(
      acknowledgementFor(
        understanding({ extractedData: { hasOnlyFans: true } }),
        "si tengo of pero me cuesta mucho llevarlo sola"
      )
    ).toBe("Te entiendo");
    expect(acknowledgementFor(understanding({ intent: "UNCLEAR" }), "no se si valdre, me da un poco de verguenza")).toBe(
      "Entiendo"
    );
    expect(acknowledgementFor(understanding(), "lo deje porque me agobiaba")).toBe("Te entiendo");
  });

  it("usa acuse neutro para una respuesta de dato normal (sin dramatizar)", () => {
    expect(acknowledgementFor(understanding({ extractedData: { age: 24 } }), "tengo 24")).toBe("Perfecto");
    expect(acknowledgementFor(understanding(), "soy de madrid")).toBe("Vale pues");
  });

  it("es una frase fija: nunca contiene hechos, cifras ni politicas", () => {
    const ack = acknowledgementFor(understanding({ extractedData: { hasOnlyFans: true } }), "tuve of pero me costaba mucho");
    expect(ack).toBe("Te entiendo");
    expect(ack).not.toMatch(/%|\d|trabajamos|solo con|activo/i);
  });
});
