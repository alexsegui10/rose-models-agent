import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresion del bucle humano (auditoria 16-jun): las respuestas MANUALES de Alex se guardan con
// author "ALEX" pero role "agent" (no "alex"), para que los guards deterministas del motor (que filtran
// role==="agent") las VEAN. Antes, con role "alex", el motor era ciego a lo que Alex escribia a mano y
// al reanudar podia repetir o contradecir su respuesta. Este test falla si se vuelve al role "alex".
describe("Contexto tras intervencion manual de Alex (pausa -> responde a mano -> reanuda)", () => {
  function createEngine() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    return { engine, repository };
  }

  it("el bot VE la pregunta que Alex hizo a mano: un 'no' posterior se interpreta en contexto", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "manual_ctx", profileVisibility: "PUBLIC" }),
        currentState: "QUALIFYING",
        firstName: "Ana",
        age: 25,
        isAdultConfirmed: true,
        hasOnlyFans: false
      })
    );
    // Alex responde a mano, igual que la ruta manual-reply tras el fix (role agent, author ALEX):
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "agent",
      author: "ALEX",
      content: "Has trabajado alguna vez con otras agencias?",
      createdAt: new Date()
    });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "manual_ctx",
      message: "no"
    });

    // El motor ve la pregunta manual de Alex y entiende el "no" como "no trabaja con otras agencias".
    // Con role "alex" (bug) lastAgentLine no la veria y el dato quedaria sin resolver.
    expect(result.candidate.worksWithAnotherAgency).toBe(false);
  });

  // Contraste que documenta el bug original: con role "alex" el motor era CIEGO al mensaje manual y el
  // "no" quedaba sin contexto. Por eso la ruta manual-reply ahora guarda role "agent" (author "ALEX").
  it("(contraste) con role 'alex' el motor NO veia el mensaje manual y el 'no' quedaba sin resolver", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "manual_alex_bug", profileVisibility: "PUBLIC" }),
        currentState: "QUALIFYING",
        firstName: "Ana",
        age: 25,
        isAdultConfirmed: true,
        hasOnlyFans: false
      })
    );
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: seeded.id,
      role: "alex",
      author: "ALEX",
      content: "Has trabajado alguna vez con otras agencias?",
      createdAt: new Date()
    });

    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "manual_alex_bug",
      message: "no"
    });

    // role "alex" -> el motor no ve la pregunta -> el "no" no se resuelve como dato de agencias.
    expect(result.candidate.worksWithAnotherAgency).toBeUndefined();
  });
});
