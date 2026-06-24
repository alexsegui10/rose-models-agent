import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { ModelConversationOutputSchema, type ConversationUnderstandingProvider } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// PIEZA 1 (Alex 24-jun): la IA marca `relevantTopics` y el retriever los usa de forma ADITIVA para surfacear
// conocimiento aunque ningun regex pille el fraseo (mata la familia de bugs "una palabra dispara/ignora algo").
// Tests: (a) el boost surfacea la categoria; (b) ADVERSARIAL invariante 3: una relevancia COMMERCIAL alucinada
// NO filtra el 70/30 (lo gatean el planner + factualValidator, no la relevancia).

function fakeUnderstanding(over: Record<string, unknown>): ConversationUnderstandingProvider {
  return {
    async understand() {
      return ModelConversationOutputSchema.parse({
        intent: "CONFIRMS_INTEREST",
        confidence: 0.9,
        suggestedStateTransition: null,
        requiresHumanReview: false,
        humanReviewReason: null,
        response: "",
        ...over
      });
    }
  };
}

describe("Pieza 1: relevantTopics (la IA decide relevancia, aditivo, sin tocar el negocio)", () => {
  it("BOOST: relevantTopics surfacea la categoria aunque el fraseo NO tenga ninguna keyword", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "rt1" }),
      currentState: "QUALIFYING" as CandidateState
    });
    const question = "uff no se yo la verdad";
    const sinTopics = await retriever.retrieve({ candidate, intent: "OTHER", question });
    const conTopics = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question,
      relevantTopics: ["CANDIDATE_REQUIREMENTS"]
    });

    // Sin la pista de la IA, ese fraseo no surfacea el perfil objetivo; CON la pista, si (aditivo).
    expect(sinTopics.some((e) => e.category === "CANDIDATE_REQUIREMENTS")).toBe(false);
    expect(conTopics.some((e) => e.category === "CANDIDATE_REQUIREMENTS")).toBe(true);
  });

  it("el boost NO salta el gating: una entrada 'sensitive' (reparto) NO surfacea solo por marcar COMMERCIAL", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "rt_sens" }),
      currentState: "QUALIFYING" as CandidateState
    });
    // Mensaje neutro + COMMERCIAL relevante: surfacea conocimiento comercial NO sensible, pero NUNCA una
    // entrada marcada 'sensitive' (esa exige el tag sensitive del propio mensaje, no la relevancia).
    const entries = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question: "me interesa",
      relevantTopics: ["COMMERCIAL"]
    });
    expect(entries.some((e) => e.tags.includes("sensitive"))).toBe(false);
  });

  it("ADVERSARIAL invariante 3: relevantTopics COMMERCIAL alucinado NO filtra el 70/30 (no preguntó la cifra)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: fakeUnderstanding({ intent: "CONFIRMS_INTEREST", relevantTopics: ["COMMERCIAL"] }),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "rt2", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        currentState: "QUALIFYING" as CandidateState
      })
    );

    const r = await engine.handleIncomingTurn({
      instagramUsername: seeded.instagramUsername,
      messages: [{ content: "me interesa mucho la verdad" }]
    });

    // Aunque la IA marque COMMERCIAL relevante, la cifra del reparto NUNCA se filtra si no la preguntó.
    expect(r.response).not.toMatch(/70\s?%|30\s?%|70\/30|setenta por ciento|treinta por ciento/i);
  });
});
