import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider, extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput
} from "@/application/llmProvider";

// Bugs hallados replayando conversaciones reales del export de Instagram (15-jun).

describe("Replay bug: captura de OF ante afirmacion doblada ('Sisi tengo...')", () => {
  const askedOf = { lastAgentMessage: "Tienes of o has tenido alguna vez?" };
  for (const reply of [
    "Sisi tengo. Tengo una cuenta activa con un manager",
    "si si tengo",
    "siii claro ya tengo",
    "sip, tengo una cuenta"
  ]) {
    it(`"${reply}" marca hasOnlyFans=true`, () => {
      const u = extractDeterministicUnderstanding(reply, askedOf);
      expect(u.extractedData.hasOnlyFans).toBe(true);
    });
  }

  it("no confunde 'siempre' con un si", () => {
    const u = extractDeterministicUnderstanding("siempre trabaje sola la verdad", askedOf);
    expect(u.extractedData.hasOnlyFans).toBeUndefined();
  });

  it("una negacion doblada sigue marcando false", () => {
    const u = extractDeterministicUnderstanding("nono, no tengo todavia", askedOf);
    expect(u.extractedData.hasOnlyFans).toBe(false);
  });
});

describe("Replay bug: 'N años' de DURACION no es edad (no cerrar adultas como menores)", () => {
  const notAge = [
    "trabajo en esto hace un año y medio o 2 años",
    "llevo 5 años en esto",
    "tengo 2 años de experiencia",
    "tengo 3 años en el sector",
    "hace 4 años que empece"
  ];
  for (const message of notAge) {
    it(`"${message}" NO extrae edad`, () => {
      const u = extractDeterministicUnderstanding(message, {});
      expect(u.extractedData.age === undefined || u.extractedData.age >= 18).toBe(true);
    });
  }

  const realAges: Array<[string, number]> = [
    ["tengo 16 años", 16],
    ["tengo 17", 17],
    ["tengo 25 años", 25],
    ["tengo 30", 30],
    // INVARIANTE 2: "N años de edad" es EDAD, no duracion (no debe escaparse una menor).
    ["tengo 16 años de edad", 16],
    ["16 años de edad", 16],
    ["tengo 17 años ya", 17],
    ["tengo 15 años en esto", 15],
    // Menores <13 sueltas tambien cierran (no usar un suelo numerico que las deje pasar).
    ["12 años", 12],
    ["tengo 12 años", 12],
    ["10 años", 10],
    // Hallazgo del revisor: una cifra en rango de menor (13-17) cierra AUNQUE haya marcador fuerte de
    // duracion. Safety-first: cerrar una adulta rara ("16 años de experiencia") < colar una menor.
    ["tengo 16 años trabajando", 16],
    ["tengo 17 años currando", 17],
    ["tengo 13 años de experiencia", 13],
    ["tengo 16 años haciendo contenido", 16],
    ["tengo 15 años trabajando", 15]
  ];
  for (const [message, age] of realAges) {
    it(`"${message}" SI extrae edad ${age}`, () => {
      const u = extractDeterministicUnderstanding(message, {});
      expect(u.extractedData.age).toBe(age);
    });
  }

  it("'16 años' suelto como respuesta a la edad se lee como edad", () => {
    const u = extractDeterministicUnderstanding("16 años", { lastAgentMessage: "Que edad tienes?" });
    expect(u.extractedData.age).toBe(16);
  });
});

describe("Replay bug: 'tengo dos/una' como respuesta a '¿tienes OF?' marca true", () => {
  const askedOf = { lastAgentMessage: "Tienes of o has tenido alguna vez?" };
  for (const reply of ["Tengo dos, una free que tiene varios años, otra vip", "tengo una cuenta activa", "ya tengo, una vip"]) {
    it(`"${reply}" marca hasOnlyFans=true`, () => {
      const u = extractDeterministicUnderstanding(reply, askedOf);
      expect(u.extractedData.hasOnlyFans).toBe(true);
    });
  }
});

describe("Replay bug: movil NO_ELIGIBLE que mejora / no repetir el rechazo (caso carola)", () => {
  function engine() {
    const repository = new InMemoryCandidateRepository();
    return new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
  }

  it("cuando reporta un movil mejor, reconoce el cambio (no repite 'lamentablemente')", async () => {
    const e = engine();
    const a = await e.handleIncomingMessage({ instagramUsername: "carola", profileVisibility: "PUBLIC", message: "hola" });
    await e.handleIncomingMessage({ candidateId: a.candidate.id, instagramUsername: "carola", message: "Motorola E32" });
    const upgrade = await e.handleIncomingMessage({
      candidateId: a.candidate.id,
      instagramUsername: "carola",
      message: "Conseguí un iPhone 11"
    });
    expect(upgrade.response.toLowerCase()).not.toContain("lamentablemente con ese movil");
    expect(upgrade.response.toLowerCase()).toMatch(/cambiad|genial|valor|lo veo|lo reviso/);
  });

  it("no repite el rechazo de movil identico turno tras turno", async () => {
    const e = engine();
    const a = await e.handleIncomingMessage({ instagramUsername: "carola2", profileVisibility: "PUBLIC", message: "hola" });
    const first = await e.handleIncomingMessage({
      candidateId: a.candidate.id,
      instagramUsername: "carola2",
      message: "Motorola E32"
    });
    const second = await e.handleIncomingMessage({
      candidateId: a.candidate.id,
      instagramUsername: "carola2",
      message: "uy que lastima"
    });
    expect(second.response).not.toBe(first.response);
  });
});

// Stub que fuerza intent=DECLINES SOLO en el mensaje largo (como a veces hace el LLM), dejando que
// el opener avance con normalidad. Asi probamos el guard del cierre en el turno problematico real.
class ForcedDeclineProvider implements ConversationUnderstandingProvider {
  async understand(input: { inboundMessage: string }): Promise<ModelConversationOutput> {
    const declines = /siempre trabaje|no me interesa/.test(input.inboundMessage.toLowerCase());
    return ModelConversationOutputSchema.parse({
      intent: declines ? "DECLINES" : "CONFIRMS_INTEREST",
      extractedData: {},
      confidence: 0.6,
      suggestedStateTransition: null,
      requiresHumanReview: false,
      humanReviewReason: null,
      response: ""
    });
  }
}

describe("Replay bug: no cerrar a una candidata que EXPLICA (DECLINES mal clasificado)", () => {
  function engineWithForcedDecline() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new ForcedDeclineProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever()
    });
    return { engine, repository };
  }

  it("un mensaje largo explicativo (empieza por 'No,') NO cierra aunque el LLM diga DECLINES", async () => {
    const { engine } = engineWithForcedDecline();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "explica",
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "explica",
      message:
        "No, siempre trabaje con agencias me refiero a que llevo dos anos en esto, dentro de ese tiempo trabaje con varias y ahora tengo una cuenta que hice yo misma porque las otras me las borraron"
    });
    expect(result.candidate.currentState).not.toBe("CLOSED");
  });

  it("un rechazo corto y explicito SI cierra", async () => {
    const { engine } = engineWithForcedDecline();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "rechaza",
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "rechaza",
      message: "no me interesa, gracias"
    });
    expect(result.candidate.currentState).toBe("CLOSED");
  });
});
