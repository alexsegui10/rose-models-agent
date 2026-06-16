import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Invariante 2 (endurecido sin depender de OpenAI): si la candidata declara una edad adulta LIMITE
// (18-22) pero el texto sugiere aparentar/ser menor de 18, NO se da por buena: se marca revision humana
// para que Alex lo verifique. No cierra (no se declara menor) ni decide el flujo: solo levanta la mano.
describe("Edad dudosa por apariencia: adulta-limite que dice aparentar menor -> revision humana", () => {
  const doubtful = [
    "tengo 19 aunque dicen que parezco de 15",
    "tengo 18 pero aparento de 14",
    "tengo 20 y aparento de 16",
    "tengo 19, me dicen que tengo cara de nina"
  ];

  for (const message of doubtful) {
    it(`marca revision humana ante "${message}" sin leerla como menor`, () => {
      const u = extractDeterministicUnderstanding(message, { lastAgentMessage: "Que edad tienes?" });
      expect(u.extractedData.age !== undefined && (u.extractedData.age as number) >= 18).toBe(true);
      expect(u.requiresHumanReview).toBe(true);
    });
  }

  it("NO escala a una adulta normal (parece mayor, de su edad, o digito suelto no-edad)", () => {
    for (const message of [
      "tengo 19",
      "tengo 25 y parezco de 30",
      "tengo 22 pero parezco de 20",
      // Digito suelto cerca de 'parezco' que NO es edad: no debe escalar (conector de edad ausente).
      "tengo 19 y parezco la 1 de la noche de cansada"
    ]) {
      const u = extractDeterministicUnderstanding(message, { lastAgentMessage: "Que edad tienes?" });
      expect(u.requiresHumanReview).toBe(false);
    }
  });

  // La frase explicita "menor de edad" la captura la regla de minoria (declaredMinorAge) y CIERRA, aunque
  // venga con "parezco": es el comportamiento conservador de seguridad (invariante 2), no la via de duda.
  it("'parezco menor de edad' cierra por la regla de minoria explicita (conservador)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "age_doubt_explicit",
      profileVisibility: "PUBLIC",
      message: "tengo 18 pero parezco menor de edad"
    });
    expect(result.candidate.currentState).toBe("CLOSED");
  });

  it("a nivel motor: la edad dudosa NO avanza, se desvia a intervencion humana", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    const result = await engine.handleIncomingMessage({
      instagramUsername: "age_doubt",
      profileVisibility: "PUBLIC",
      message: "tengo 19 aunque dicen que parezco de 15"
    });
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    // No avanza al embudo de aprobacion (no llega a 'lista para revisar' ni mas alla).
    expect(["WAITING_HUMAN_REVIEW", "APPROVED", "COLLECTING_CALL_DETAILS", "CALL_SCHEDULED"]).not.toContain(
      result.candidate.currentState
    );
  });
});
