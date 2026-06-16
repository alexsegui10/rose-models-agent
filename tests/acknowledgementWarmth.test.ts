import { describe, expect, it } from "vitest";
import { acknowledgementFor } from "@/application/conversationEngine";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";

function understanding(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData: {},
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
}

// La candidata que se abre (inseguridad, nunca lo ha hecho, miedo) debe recibir un acuse EMPATICO
// ("Te entiendo"), nunca un "Perfecto" frio (validacion OpenAI 16-jun: respondia frio a la inseguridad).
describe("acknowledgementFor: calidez ante vulnerabilidad", () => {
  for (const message of [
    "nunca he hecho esto y me da inseguridad",
    "me da inseguridad la verdad",
    "estoy insegura, no se",
    "no me atrevo del todo",
    "me da un poco de corte"
  ]) {
    it(`responde con empatia a "${message}"`, () => {
      const ack = acknowledgementFor(understanding(), message).toLowerCase();
      expect(ack).toContain("entiendo");
    });
  }

  it("no rompe el acuse normal cuando hay un dato (sigue siendo 'Perfecto')", () => {
    const ack = acknowledgementFor(understanding({ extractedData: { age: 24 } }), "tengo 24");
    expect(ack).toBe("Perfecto");
  });
});
