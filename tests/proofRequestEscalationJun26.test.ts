import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// QA sweep 26-jun: "me pueden mostrar cuentas que manejen?" (peticion de pruebas, mensaje real) NO escalaba: el
// regex de proof-request solo pillaba "muestrame/me muestras", no "(me) pueden/podeis/podrian mostrar/ensenar".
// Decision de Alex 19-jun: las peticiones de PRUEBAS sensibles (cuentas/backend/panel) escalan SIEMPRE a el.

function mk() {
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

async function seedAdult(repository: InMemoryCandidateRepository, username: string) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      currentState: "QUALIFYING" as CandidateState
    })
  );
}

describe("Peticion de pruebas escala a revision (Alex 19-jun, QA sweep 26-jun)", () => {
  it("'(me) pueden/podrian mostrar/ensenar cuentas/perfiles/resultados' -> ESCALA a revision humana", async () => {
    for (const msg of [
      "me pueden mostrar cuentas que manejen?",
      "me podrian ensenar perfiles que llevais?",
      "pueden mostrarme resultados de otras modelos?",
      "captura del panel de ganancias?"
    ]) {
      const { engine, repository } = mk();
      const c = await seedAdult(repository, "proof_" + Math.random().toString().slice(2, 6));
      const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: msg }] });
      expect(r.candidate.currentState, `"${msg}"`).toBe("HUMAN_INTERVENTION_REQUIRED");
    }
  });

  it("una peticion BENIGNA ('me pueden mostrar el proceso?') NO escala (scope a pruebas sensibles)", async () => {
    const { engine, repository } = mk();
    const c = await seedAdult(repository, "benign_" + Math.random().toString().slice(2, 6));
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "me pueden mostrar el proceso?" }]
    });
    expect(r.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});
