import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { createCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresion de la taxonomia nº1 de la iteracion 3 (answer-slot blindness): la respuesta de la
// candidata a la pregunta pendiente del agente debe consumir el slot SIEMPRE, tambien en el
// proveedor determinista. r14-t2/r15-t2 re-preguntaron el nombre tras "Noelia"/"Gisell" y
// r15-t5/t6 repitieron la pregunta de OF tras "es la primera vez que uso only".

describe("dataExtractor contextual answers (la respuesta al ultimo mensaje del agente consume el slot)", () => {
  it("reads a bare name reply right after the agent asked for the name (replay-14 T2)", () => {
    const result = extractDeterministicUnderstanding("Noelia", { lastAgentMessage: "Perfecto\n\nComo te llamas?" });
    expect(result.extractedData.firstName).toBe("Noelia");
  });

  it("reads a two-word name reply taking the first name only", () => {
    const result = extractDeterministicUnderstanding("gisell torres", { lastAgentMessage: "Como te llamas?" });
    expect(result.extractedData.firstName).toBe("Gisell");
  });

  it("does not mistake fillers, greetings or weekdays for a name", () => {
    for (const reply of ["vale", "hola", "jajaja", "claro", "domingo", "gracias", "bueno"]) {
      const result = extractDeterministicUnderstanding(reply, { lastAgentMessage: "Como te llamas?" });
      expect(result.extractedData.firstName).toBeUndefined();
    }
  });

  it("does not read a bare word as a name without the name question context", () => {
    const result = extractDeterministicUnderstanding("Noelia", { lastAgentMessage: "Que dia y hora te viene bien?" });
    expect(result.extractedData.firstName).toBeUndefined();
  });

  it("reads a bare number reply as the age right after the age question", () => {
    const result = extractDeterministicUnderstanding("19", { lastAgentMessage: "Okeyy\n\nQue edad tienes?" });
    expect(result.extractedData.age).toBe(19);
    expect(result.intent).toBe("PROVIDES_AGE");
  });

  it("keeps closing minors when the bare number is under 18", () => {
    const result = extractDeterministicUnderstanding("16", { lastAgentMessage: "Que edad tienes?" });
    expect(result.extractedData.age).toBe(16);
  });

  it("never reads embedded numbers as age (invariante 2: nada de edades fantasma)", () => {
    const result = extractDeterministicUnderstanding("Tengo 2 cuentas en uso", { lastAgentMessage: "Que edad tienes?" });
    expect(result.extractedData.age).toBeUndefined();
  });

  it("reads 'es la primera vez que uso only' as having OnlyFans (replay-15 T5)", () => {
    const result = extractDeterministicUnderstanding("es la primera vez que uso only");
    expect(result.extractedData.hasOnlyFans).toBe(true);
  });

  it("keeps 'nunca use only' as not having OnlyFans", () => {
    const result = extractDeterministicUnderstanding("no, nunca use only");
    expect(result.extractedData.hasOnlyFans).toBe(false);
  });

  it("reads a bare yes/no to the OnlyFans question", () => {
    const yes = extractDeterministicUnderstanding("Sii", { lastAgentMessage: "Tienes of o has tenido alguna vez?" });
    expect(yes.extractedData.hasOnlyFans).toBe(true);

    const no = extractDeterministicUnderstanding("No", { lastAgentMessage: "Tienes of o has tenido alguna vez?" });
    expect(no.extractedData.hasOnlyFans).toBe(false);
  });

  it("reads a bare yes/no to the agencies question", () => {
    const yes = extractDeterministicUnderstanding("Si", {
      lastAgentMessage: "Has trabajado alguna vez con otras agencias?"
    });
    expect(yes.extractedData.worksWithAnotherAgency).toBe(true);

    const no = extractDeterministicUnderstanding("No, nunca", {
      lastAgentMessage: "Has trabajado alguna vez con otras agencias?"
    });
    expect(no.extractedData.worksWithAnotherAgency).toBe(false);
  });

  it("does not apply yes/no answers without the matching question context", () => {
    const result = extractDeterministicUnderstanding("Si", { lastAgentMessage: "Que dia y hora te viene bien?" });
    expect(result.extractedData.hasOnlyFans).toBeUndefined();
    expect(result.extractedData.worksWithAnotherAgency).toBeUndefined();
  });
});

describe("ConversationEngine never re-asks the question the candidate just answered (replay-14/15)", () => {
  async function seededQualifying(username: string) {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    const seeded = await repository.saveCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      currentState: "QUALIFYING"
    });
    return { engine, repository, seeded };
  }

  it("advances name -> age -> of -> agencias consuming each bare answer", async () => {
    const { engine, seeded } = await seededQualifying("lead_respuestas_peladas");

    const askName = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_respuestas_peladas",
      message: "Holaa"
    });
    expect(askName.response.toLowerCase()).toContain("como te llamas");

    const askAge = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_respuestas_peladas",
      message: "Noelia"
    });
    expect(askAge.candidate.firstName).toBe("Noelia");
    expect(askAge.response.toLowerCase()).not.toContain("como te llamas");
    expect(askAge.response.toLowerCase()).toContain("que edad tienes");

    const askOnlyFans = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_respuestas_peladas",
      message: "27"
    });
    expect(askOnlyFans.candidate.age).toBe(27);
    expect(askOnlyFans.response.toLowerCase()).not.toContain("que edad tienes");
    expect(askOnlyFans.response.toLowerCase()).toContain("has tenido of");

    const askAgencies = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_respuestas_peladas",
      message: "Es la primera vez que uso only"
    });
    expect(askAgencies.candidate.hasOnlyFans).toBe(true);
    expect(askAgencies.response.toLowerCase()).not.toContain("has tenido of");
    expect(askAgencies.response.toLowerCase()).toContain("otras agencias");
  });
});
