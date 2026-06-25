import { describe, expect, it } from "vitest";
import { goldenConversationTests } from "@/content/golden/goldenConversationTests";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { evaluateResponseStyle } from "@/application/styleEvaluator";
import { createCandidate, type Candidate, type ProfileVisibility } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

describe("golden style tests", () => {
  for (const golden of goldenConversationTests) {
    it(golden.title, async () => {
      const repository = new InMemoryCandidateRepository();
      const engine = new ConversationEngine({
        repository,
        understandingProvider: new DeterministicUnderstandingProvider(),
        exampleRetriever: new LocalExampleRetriever()
      });
      const seeded = seedCandidate(golden.id, golden.initialCandidate, golden.stateBefore);
      await repository.saveCandidate(seeded);

      // Cambio de comportamiento (Alex 25-jun): el PRIMER turno de un lead nuevo (NEW_LEAD, sin que
      // el agente haya hablado todavia) devuelve SIEMPRE el opener canonico. Este golden manda un
      // volcado de datos de negocio como primer mensaje y espera la respuesta de negocio, asi que
      // primero consumimos el opener con un "hola" (misma candidata) y luego enviamos el mensaje real.
      if (goldenNeedsOpenerPriming(golden.id)) {
        await engine.handleIncomingMessage({
          candidateId: seeded.id,
          instagramUsername: seeded.instagramUsername,
          profileVisibility: seeded.declaredProfileVisibility,
          message: "Hola"
        });
      }

      let result = await engine.handleIncomingMessage({
        candidateId: seeded.id,
        instagramUsername: seeded.instagramUsername,
        profileVisibility: seeded.declaredProfileVisibility,
        message: golden.messages[0] ?? ""
      });

      for (const nextMessage of golden.messages.slice(1)) {
        result = await engine.handleIncomingMessage({
          candidateId: result.candidate.id,
          instagramUsername: result.candidate.instagramUsername,
          message: nextMessage
        });
      }

      if (golden.expectedTransition) {
        expect(result.candidate.currentState).toBe(golden.expectedTransition);
      }

      for (const [field, expectedValue] of Object.entries(golden.expectedExtractedFields)) {
        expect(result.candidate[field as keyof Candidate]).toBe(expectedValue);
      }

      for (const forbidden of golden.responseMustNotInclude) {
        expect(result.response.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }

      if (golden.responseMustIncludeAny.length > 0) {
        expect(golden.responseMustIncludeAny.some((item) => result.response.toLowerCase().includes(item.toLowerCase()))).toBe(
          true
        );
      }

      expect(result.retrievedExamples.length).toBeGreaterThanOrEqual(3);
      expect(result.retrievedExamples.length).toBeLessThanOrEqual(6);

      const styleEvaluation = evaluateResponseStyle(result.response, result.candidate, golden.messages.at(-1) ?? "");
      expect(styleEvaluation.usesForbiddenExpression).toBe(false);
      expect(styleEvaluation.isSpanishFromSpain).toBe(true);
      expect(styleEvaluation.asksTooManyQuestions).toBe(false);
      expect(styleEvaluation.score).toBeGreaterThanOrEqual(0.65);
    });
  }
});

// Goldens cuyo PRIMER mensaje es un mensaje de negocio (no un saludo) sobre una candidata fresca
// en NEW_LEAD: necesitan consumir el opener canonico con un "hola" previo antes de evaluar la
// respuesta de negocio. El resto de goldens NEW_LEAD ya cuentan con el opener en su guion.
function goldenNeedsOpenerPriming(id: string): boolean {
  return id === "golden-multiple-messages";
}

function seedCandidate(id: string, initialCandidate: Record<string, unknown>, stateBefore: Candidate["currentState"]): Candidate {
  const profileVisibility = profileVisibilityFrom(initialCandidate.profileVisibility);
  const candidate = createCandidate({
    instagramUsername: id.replace(/[^a-z0-9_]/gi, "_").toLowerCase(),
    profileVisibility
  });

  return {
    ...candidate,
    firstName: stringFrom(initialCandidate.firstName),
    age: numberFrom(initialCandidate.age),
    isAdultConfirmed: typeof initialCandidate.age === "number" ? initialCandidate.age >= 18 : candidate.isAdultConfirmed,
    city: stringFrom(initialCandidate.city),
    country: stringFrom(initialCandidate.country),
    phone: stringFrom(initialCandidate.phone),
    declaredProfileVisibility: profileVisibility,
    humanProfileReviewStatus: booleanFrom(initialCandidate.profileReviewed)
      ? "POTENTIAL_FIT"
      : candidate.humanProfileReviewStatus,
    hasOnlyFans: booleanFrom(initialCandidate.hasOnlyFans),
    worksWithAnotherAgency: booleanFrom(initialCandidate.worksWithAnotherAgency),
    currentState: stateBefore,
    updatedAt: new Date()
  };
}

function profileVisibilityFrom(value: unknown): ProfileVisibility {
  if (value === "PUBLIC" || value === "PRIVATE" || value === "UNKNOWN") {
    return value;
  }

  return "PUBLIC";
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
