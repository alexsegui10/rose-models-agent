import { describe, expect, it } from "vitest";
import { ConversationEngine, acknowledgementFor } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { deviceEligibilityForDescription } from "@/application/policyRules";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Feedback de la prueba E2E de Alex (2-jul, día de lanzamiento): tono más cercano, silencio en revisión
// para acuses triviales, e iPhone 12 = mínimo aceptado.

function understandingWith(extractedData: Record<string, unknown>) {
  return ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData,
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: ""
  });
}

describe("tono cercano (sin cambios grandes)", () => {
  it("al capturar el NOMBRE, el acuse lo usa una vez: 'Perfecto Ana'", () => {
    expect(acknowledgementFor(understandingWith({ firstName: "ana" }), "mi nombre es ana")).toBe("Perfecto Ana");
  });

  it("un 'no' a la pregunta de OF se reconoce con 'Entiendo' (no 'Perfecto' de formulario)", () => {
    expect(acknowledgementFor(understandingWith({ hasOnlyFans: false }), "no nunca")).toBe("Entiendo");
  });

  it("otros datos siguen con el acuse breve de siempre", () => {
    expect(acknowledgementFor(understandingWith({ age: 24 }), "tengo 24")).toBe("Perfecto");
  });
});

describe("silencio en revisión humana para acuses triviales (el 'Sin prisa...' sobrante)", () => {
  it("'okeyy perfecto' en WAITING_HUMAN_REVIEW (ya avisada del socio) -> SILENCIO, sin burbuja vacía", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "review_silencio" }),
        currentState: "WAITING_HUMAN_REVIEW",
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true
      })
    );
    // Ya se le dijo lo del socio (mensaje previo del agente).
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "agent",
      author: "AI_AGENT",
      content: "Voy a comentar tu perfil con mi socio para valorarlo bien y te digo algo.",
      createdAt: new Date()
    });
    const before = (await repository.listMessages(seeded.id)).length;

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "review_silencio",
      message: "okeyy perfecto"
    });

    expect(result.response.trim()).toBe("");
    const after = await repository.listMessages(seeded.id);
    // Se guardó SU mensaje, pero NINGUNA burbuja vacía del agente.
    expect(after.length).toBe(before + 1);
    expect(after.every((m) => m.role !== "agent" || m.content.trim().length > 0)).toBe(true);
    // Y sigue en revisión (invariante 4 intacto).
    expect(result.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("una PREGUNTA de verdad en revisión se sigue respondiendo (defensa P0 intacta)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "review_pregunta" }),
        currentState: "WAITING_HUMAN_REVIEW",
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "review_pregunta",
      message: "y cuanto os llevais vosotros de porcentaje?"
    });
    expect(result.response.trim().length).toBeGreaterThan(0);
  });
});

describe("umbral de móvil (decisión Alex 2-jul): iPhone 12 mínimo aceptado", () => {
  it("iPhone 12 -> APROBADO directo (sin 'lo valoro con mi socio')", () => {
    expect(deviceEligibilityForDescription("un iphone 12")).toBe("APPROVED");
  });
  it("iPhone X/XR/XS/11 -> dudoso (frase del socio y sigue)", () => {
    expect(deviceEligibilityForDescription("iphone 11")).toBe("PENDING_QUALITY_TEST");
    expect(deviceEligibilityForDescription("un iphone x")).toBe("PENDING_QUALITY_TEST");
  });
  it("iPhone 9 o menos -> NO elegible (pausa directa)", () => {
    expect(deviceEligibilityForDescription("iphone 8")).toBe("NOT_ELIGIBLE");
  });
});
