import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones de los 4 bloqueantes (P0) hallados por la QA E2E del 21-jun, todos verificados ejecutando
// el codigo real. Cada test falla SIN el arreglo correspondiente.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

function understand(message: string, lastAgentMessage = "Hola, como te llamas?") {
  return extractDeterministicUnderstanding(message, { lastAgentMessage });
}
function age(message: string): number | undefined {
  return extractDeterministicUnderstanding(message, { lastAgentMessage: "Que edad tienes?" }).extractedData.age;
}

async function stateForFresh(message: string): Promise<string> {
  const { engine } = createEngine();
  const result = await engine.handleIncomingMessage({
    instagramUsername: `qa_${Math.random()}`,
    profileVisibility: "PUBLIC",
    message
  });
  return result.candidate.currentState;
}

// ---------------------------------------------------------------------------
// P0-1 / P1-7: "casi 18" es MENOR, nunca adulta (invariante 2 — el peor fallo).
// ---------------------------------------------------------------------------
describe("QA P0-1/P1-7: 'casi 18' se trata como menor, jamas como adulta de 18", () => {
  const almostMinor = ["casi tengo 18", "bueno casi tengo 18 ya", "tengo casi 18", "casi 18", "casi 18 anos"];
  for (const message of almostMinor) {
    it(`"${message}" NO se lee como adulta`, () => {
      const a = age(message);
      expect(a !== undefined && a < 18).toBe(true);
    });
    it(`"${message}" cierra a nivel motor (CLOSED)`, async () => {
      expect(await stateForFresh(message)).toBe("CLOSED");
    });
  }

  // No-regresion: "casi N" en contables/duraciones NO debe cerrar a una adulta por error (invariante 2 en
  // sentido inverso — cerrar a quien no debe). Casos que el revisor cazo como regresion del primer arreglo.
  it("'tengo 25 y casi 18 mil seguidores' sigue siendo adulta de 25", () => {
    expect(age("tengo 25 y casi 18 mil seguidores")).toBe(25);
  });
  // OJO: "tengo casi 15 anos de experiencia" SI cierra, pero por la regla de seguridad PRE-EXISTENTE (una
  // cifra 13-17 + "anos" se trata como posible menor aunque diga "de experiencia"; invariante 2 a proposito),
  // no por el arreglo de "casi". Por eso aqui solo van valores <13 o contables, que es lo que mi fix protege.
  const adultsNotClosed = [
    "tengo 30, trabajo casi 10 horas al dia",
    "tengo casi 10 anos en esto",
    "tengo casi 18 euros ahorrados",
    "tengo casi 3 hijos",
    "casi tengo 2 mil seguidores"
  ];
  for (const message of adultsNotClosed) {
    it(`"${message}" NO cierra (no es una edad de menor)`, async () => {
      expect(await stateForFresh(message)).not.toBe("CLOSED");
    });
  }
});

// ---------------------------------------------------------------------------
// P0-2: acusaciones claras de fraude escalan SIEMPRE a Alex (decision 16-jun).
// ---------------------------------------------------------------------------
describe("QA P0-2: acusaciones de fraude escalan a revision humana", () => {
  const frauds = ["esto es un timo seguro", "esto es un timo", "cuantas chicas estafaste ya", "me han estafado antes"];
  for (const message of frauds) {
    it(`"${message}" -> REQUESTS_HUMAN + revision humana`, () => {
      const u = understand(message);
      expect(u.requiresHumanReview).toBe(true);
      expect(u.intent).toBe("REQUESTS_HUMAN");
    });
  }
});

// ---------------------------------------------------------------------------
// P0-3: nunca auto-agenda la llamada sin WhatsApp (si no, el bot de voz no tiene a quien llamar).
// ---------------------------------------------------------------------------
describe("QA P0-3: no auto-agenda sin numero de WhatsApp", () => {
  async function seedApproved(repository: InMemoryCandidateRepository, overrides: Record<string, unknown>) {
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `qa3_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        deviceType: "IPHONE",
        deviceModel: "iphone 13",
        deviceEligibility: "APPROVED",
        humanFitDecision: "APPROVED",
        humanProfileReviewStatus: "POTENTIAL_FIT",
        currentState: "COLLECTING_CALL_DETAILS",
        automationPaused: false,
        manualControlActive: false,
        ...overrides
      })
    );
  }

  it("propone hora SIN telefono -> NO pasa a CALL_SCHEDULED", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedApproved(repository, { phone: undefined });
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18 me viene genial"
    });
    expect(reply.candidate.currentState).not.toBe("CALL_SCHEDULED");
  });

  it("propone hora CON telefono -> SI agenda (no rompe el flujo bueno)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seedApproved(repository, { phone: "612345678" });
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18 me viene genial"
    });
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
  });
});

// ---------------------------------------------------------------------------
// P0-4: dudas de privacidad ("que me vea mi familia / gente conocida") se reconducen, no cierran el lead.
// ---------------------------------------------------------------------------
describe("QA P0-4: dudas de privacidad no cierran la candidata", () => {
  async function stateAfterInQualifying(message: string): Promise<string> {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `qa4_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true,
        currentState: "QUALIFYING"
      })
    );
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message
    });
    return reply.candidate.currentState;
  }

  const privacyWorries = [
    "no quiero que me vea mi familia ni gente conocida",
    "me da miedo que me vea mi ex",
    "no quiero que me vean por aca, hay gente conocida"
  ];
  for (const message of privacyWorries) {
    it(`"${message}" NO cierra (se reconduce)`, async () => {
      expect(await stateAfterInQualifying(message)).not.toBe("CLOSED");
    });
  }
});
