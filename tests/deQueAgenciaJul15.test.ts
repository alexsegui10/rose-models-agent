import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 15-jul): "¿de qué agencia sos?" es una pregunta de IDENTIDAD que el bot SABE
// (Rose Models), pero se difería al socio (HIR): el retriever no casaba "de qué agencia" -> knowledgeEntries
// vacío -> isBusinessQuestionWithoutCoverage por el token "agencia" -> requiresHumanReview -> HIR. Debe
// responder Rose Models, no "lo hablo con mi socio".

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

describe("'de qué agencia sos' se responde (Rose Models), no se difiere (auditoría 15-jul)", () => {
  it("responde la identidad de la agencia y NO escala a HIR", async () => {
    const { engine } = createEngine();
    const username = "de_que_agencia";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo sol" });
    const r = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "y de que agencia sos?"
    });
    expect(r.response.toLowerCase()).toContain("rose models");
    expect(r.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});
