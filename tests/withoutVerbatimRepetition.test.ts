import { describe, expect, it } from "vitest";
import { ConversationEngine, withoutVerbatimRepetition } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { ResponsePlanSchema, type ResponsePlan } from "@/domain/businessKnowledge";
import { createCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Plan minimo valido: sin hechos, sin pregunta, sin revision. Cada test sobreescribe lo que necesita.
function buildPlan(overrides: Partial<ResponsePlan> = {}): ResponsePlan {
  return ResponsePlanSchema.parse({
    objective: "test",
    questionToAsk: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    revenueSharePolicyVersion: null,
    ...overrides
  });
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

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

describe("withoutVerbatimRepetition: el Alex real nunca repite un mensaje caracter a caracter", () => {
  it("deja pasar la respuesta intacta cuando no coincide con el ultimo mensaje del agente", () => {
    const result = withoutVerbatimRepetition("Mensaje nuevo y distinto", "Otro mensaje anterior", buildPlan());
    expect(result).toBe("Mensaje nuevo y distinto");
  });

  it("deja pasar la respuesta intacta cuando no hay mensaje previo del agente", () => {
    const result = withoutVerbatimRepetition("Primer mensaje del bot", null, buildPlan());
    expect(result).toBe("Primer mensaje del bot");
  });

  it("rama (a): una repeticion generica se degrada a un acuse corto distinto ('Okeyy')", () => {
    const repeated = "Perfecto, cualquier duda que tengas me dices sin problema.";
    const result = withoutVerbatimRepetition(repeated, repeated, buildPlan());

    expect(normalize(result)).not.toBe(normalize(repeated));
    expect(result).toBe("Okeyy");
  });

  it("rama (d): si el ultimo mensaje del agente ya empezaba con 'Okeyy', alterna a 'Vale pues'", () => {
    const repeated = "Okeyy";
    const result = withoutVerbatimRepetition(repeated, repeated, buildPlan());

    expect(normalize(result)).not.toBe(normalize(repeated));
    expect(result).toBe("Vale pues");
  });

  it("rama (b): en WAITING_HUMAN_REVIEW una repeticion deriva honestamente al socio", () => {
    const repeated = "Voy a comentar tu perfil con mi socio.";
    const result = withoutVerbatimRepetition(
      repeated,
      repeated,
      buildPlan({ requiresHumanReview: true }),
      "WAITING_HUMAN_REVIEW"
    );

    expect(normalize(result)).not.toBe(normalize(repeated));
    expect(result.toLowerCase()).toContain("pendiente con mi socio");
    // Nunca se degrada a un acuse vacio cuando algo sigue pendiente con Alex.
    expect(result).not.toBe("Okeyy");
    expect(result).not.toBe("Vale pues");
  });

  it("rama (b): en HUMAN_INTERVENTION_REQUIRED una pregunta sin cubrir tambien deriva al socio", () => {
    const repeated = "Eso dejame que lo hable con mi socio y te digo.";
    const result = withoutVerbatimRepetition(
      repeated,
      repeated,
      buildPlan({ uncoveredQuestion: true }),
      "HUMAN_INTERVENTION_REQUIRED"
    );

    expect(normalize(result)).not.toBe(normalize(repeated));
    expect(result.toLowerCase()).toContain("pendiente con mi socio");
  });

  it("rama (c): con una pregunta de cualificacion pendiente cambia el acuse pero SIGUE preguntando", () => {
    const question = "Como te llamas?";
    const repeated = `Perfecto\n\n${question}`;
    const result = withoutVerbatimRepetition(repeated, repeated, buildPlan({ questionToAsk: question }));

    // La respuesta cambia (ya no es identica) pero conserva la pregunta del slot.
    expect(normalize(result)).not.toBe(normalize(repeated));
    expect(normalize(result)).toContain(normalize(question));
    // El acuse inicial se intercambia (Perfecto -> Okeyy), no se borra la pregunta.
    expect(result.startsWith("Okeyy")).toBe(true);
  });

  it("en estados terminales (CLOSED) prefiere repetir el cierre antes que degradar a un acuse suelto", () => {
    const closing = "Esa es nuestra manera de trabajar, un saludo y mucha suerte.";
    const result = withoutVerbatimRepetition(closing, closing, buildPlan(), "CLOSED");

    // En CLOSED/REJECTED/CALL_SCHEDULED se devuelve tal cual: degradar reabriria la conversacion.
    expect(result).toBe(closing);
  });
});

describe("withoutVerbatimRepetition: comportamiento end-to-end via motor", () => {
  it("regression: el motor no repite verbatim el opener fijo de espera de acceso al perfil", async () => {
    // En WAITING_PROFILE_ACCESS la respuesta es un opener FIJO; sin el guard el segundo turno seria
    // identico caracter a caracter. El guard lo degrada a un acuse corto (rama generica).
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate({
      ...createCandidate({ instagramUsername: "lead_no_repite", profileVisibility: "PRIVATE" }),
      currentState: "WAITING_PROFILE_ACCESS"
    });

    const first = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_no_repite",
      message: "hola?"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: "lead_no_repite",
      message: "hola?"
    });

    expect(first.response.length).toBeGreaterThan(0);
    expect(second.response.length).toBeGreaterThan(0);
    // El primer turno entrega el opener fijo completo; el segundo NO puede ser identico.
    expect(first.response.toLowerCase()).toContain("solicitud de seguimiento");
    expect(normalize(second.response.trim())).not.toBe(normalize(first.response.trim()));
  });
});
