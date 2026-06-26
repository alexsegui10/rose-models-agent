import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// QA sweep 26-jun: "sisi trabaje con 4 agencias" / "trabaje sola" (respuestas reales al slot de agencias) no se
// extraian (solo "otra agencia/trabajo con agencia" singular/presente) -> el bot RE-PREGUNTABA "has trabajado
// con otras agencias?". FIX: el positivo cubre pasado/plural ("trabaje con agencias", "he trabajado con N"); y
// "sin agencia"/"sola"(acotado al slot)/"por mi cuenta" -> false. Generico ("trabajo sola en casa" sin preguntar
// por agencias) NO marca false.

const ASK = { lastAgentMessage: "has trabajado alguna vez con otras agencias?" } as const;
const NO_ASK = { lastAgentMessage: "que movil tienes?" } as const;

function wwa(message: string, ctx: { lastAgentMessage: string }) {
  return (extractDeterministicUnderstanding(message, ctx) as { extractedData?: { worksWithAnotherAgency?: boolean } })
    .extractedData?.worksWithAnotherAgency;
}

describe("Extraccion de agencias: pasado/plural y 'sola' (Alex 26-jun, QA sweep)", () => {
  it("positivo en pasado/plural -> true", () => {
    for (const m of [
      "sisi trabaje con 4 agencias",
      "trabaje con agencias",
      "siempre trabaje con agencias",
      "he trabajado con 2 agencias"
    ]) {
      expect(wwa(m, ASK), m).toBe(true);
    }
  });

  it("trabajo sola / sin agencia / por mi cuenta -> false", () => {
    expect(wwa("sin agencia siempre", ASK)).toBe(false);
    expect(wwa("trabaje sola", ASK)).toBe(false);
    expect(wwa("por mi cuenta", ASK)).toBe(false);
    expect(wwa("no nunca con agencias", ASK)).toBe(false);
  });

  it("generico fuera del slot de agencias NO marca false", () => {
    expect(wwa("trabajo sola en casa", NO_ASK)).toBeUndefined();
    expect(wwa("soy autonoma", NO_ASK)).toBeUndefined();
  });
});

describe("El slot de agencias no se re-pregunta tras 'trabaje con 4 agencias' (E2E)", () => {
  it("consume el slot y avanza (no vuelve a preguntar por agencias)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const c = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "ag_e2e", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 30,
        isAdultConfirmed: true,
        hasOnlyFans: true,
        currentState: "QUALIFYING" as CandidateState
      })
    );
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "sisi trabaje con 4 agencias" }]
    });
    expect(r.candidate.worksWithAnotherAgency).toBe(true);
    expect(r.response.toLowerCase()).not.toMatch(/otras? agencias?|has trabajado/);
  });
});
