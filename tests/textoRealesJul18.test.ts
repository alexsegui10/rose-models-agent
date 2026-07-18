import { describe, expect, it } from "vitest";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { buildResponsePlan } from "@/application/responsePlanner";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// LOTE T1 (18-jul): conversaciones REALES de candidatas (Daiana, Bianca, Ale) con fallos graves.
// El bot de texto vuelve a ser la prioridad (decisión de Alex: "pausamos voz").

const provider = new DeterministicUnderstandingProvider();
const AGENT_OF_Q = "agent: Me puedes contar si has tenido OF alguna vez?";

async function extractOF(message: string) {
  const u = await provider.understand({ inboundMessage: message, recentMessages: [AGENT_OF_Q] } as never);
  return (u.extractedData ?? {}) as { hasOnlyFans?: boolean; worksWithAnotherAgency?: boolean };
}

describe("extractor: las historias REALES de Daiana/Bianca capturan el OF (antes: 4 re-preguntas)", () => {
  it("'Lo hice, entré a una agencia hace 3 meses, lo verifiqué pero no hice nada aún' -> OF=true", async () => {
    const d = await extractOF("Lo hice entre a una agencia hace 3 meses lo verifique pero no hice nada aun");
    expect(d.hasOnlyFans).toBe(true);
  });

  it("'La hice la verifiqué y nada más' -> OF=true", async () => {
    expect((await extractOF("La hice la verifique y nada mas")).hasOnlyFans).toBe(true);
  });

  it("'No yo hice la cuenta y la verifiqué pero no se la pasé a ellos' -> OF=true (el 'No' es de OTRA cosa)", async () => {
    const d = await extractOF("No yo hice la cuenta y la verifique pero no se la pase a ellos la tengo yo a la cuenta");
    expect(d.hasOnlyFans).toBe(true);
  });

  it("Bianca: 'tengo una cuenta de 600 seguidores pero no tengo TIEMPO' -> OF=true (no false)", async () => {
    const d = await extractOF(
      "Si trabajé con una agencia 3 años y ahora tengo una cuenta de 600 seguidores pero que no tengo tiempo para manejarla realmente"
    );
    expect(d.hasOnlyFans).toBe(true);
    expect(d.worksWithAnotherAgency).toBe(true);
  });

  it("una cuenta de INSTAGRAM no cuenta como OF (revisor T1)", async () => {
    expect((await extractOF("hice la cuenta de instagram que me pidieron")).hasOnlyFans).not.toBe(true);
    expect((await extractOF("no, solo tengo una cuenta de instagram")).hasOnlyFans).not.toBe(true);
  });

  it("las negaciones DIRECTAS siguen siendo false (no se debilita)", async () => {
    expect((await extractOF("No")).hasOnlyFans).toBe(false);
    expect((await extractOF("nunca la hice")).hasOnlyFans).toBe(false);
    expect((await extractOF("no tengo cuenta de eso")).hasOnlyFans).toBe(false);
    expect((await extractOF("no llegue a hacerme la cuenta")).hasOnlyFans).toBe(false);
  });
});

describe("tope anti-bucle: las REFORMULACIONES del redactor también cuentan (Daiana: OF preguntado 4 veces)", () => {
  function planFor(recentAgentMessages: string[]) {
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "cap_test" }),
      firstName: "Daiana",
      age: 34,
      isAdultConfirmed: true,
      deviceEligibility: "PENDING_QUALITY_TEST",
      deviceModel: "Samsung",
      currentState: "QUALIFYING"
    } as unknown as Candidate);
    const understanding = ModelConversationOutputSchema.parse({
      intent: "OTHER",
      extractedData: {},
      confidence: 0.8,
      suggestedStateTransition: null,
      requiresHumanReview: false,
      humanReviewReason: null,
      response: ""
    });
    return buildResponsePlan({
      candidate,
      understanding,
      inboundMessage: "bueno",
      knowledgeEntries: [],
      hasApprovedNegotiationDecision: false,
      recentAgentMessages,
      isOpenerTurn: false
    });
  }

  it("dos variantes reformuladas de la pregunta del OF agotan el cupo: no se pregunta una 3ª vez", () => {
    const plan = planFor([
      "Me puedes contar si has tenido OF alguna vez?",
      "y ahora mismo tienes cuenta de only creada o no?" // la reformulación del redactor que antes NO contaba
    ]);
    expect(plan.questionToAsk ?? "").not.toMatch(/of|onlyfans|only/i);
  });

  it("con solo UNA pregunta hecha, la re-pregunta sigue permitida (el cupo es 2, no 1)", () => {
    const plan = planFor(["Me puedes contar si has tenido OF alguna vez?"]);
    expect(plan.questionToAsk ?? "").toMatch(/of|onlyfans/i);
  });

  it("la RESPUESTA del bot sobre la cuenta NO agota el cupo (revisor T1: evitaba el dead-end silencioso)", () => {
    // "La cuenta de OnlyFans la abres tú" es una RESPUESTA, no la pregunta del slot: si contara, el cupo de
    // 2 se agotaba en silencio y la cualificación se quedaba estancada sin llegar a preguntar el OF.
    const plan = planFor(["La cuenta de OnlyFans la abres tu, es muy facil.", "Me puedes contar si has tenido OF alguna vez?"]);
    // Solo cuenta la pregunta real (1 de 2): la re-pregunta sigue disponible.
    expect(plan.questionToAsk ?? "").toMatch(/of|onlyfans/i);
  });
});

describe("'¿qué contenido debo enviarte?' responde con la ficha de Alex (referencias + guiones), no otra cosa", () => {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "content_q" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);

  it("las preguntas REALES de Ale y Daiana surfacean content-what-to-send", async () => {
    for (const q of [
      "Cuanto contenido debo enviarte? Que tipo de contenido ?",
      "Y q m pides para comenzar",
      "que tipo de contenido necesitan?"
    ]) {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question: q,
        ignoreStateGating: true
      });
      expect(
        entries.some((e) => e.id === "content-what-to-send"),
        q
      ).toBe(true);
    }
  });

  it("la ficha lleva las palabras de Alex (referencias para IG, guiones para OF, después de la llamada)", async () => {
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "que tipo de contenido debo enviarte?",
      ignoreStateGating: true
    });
    const entry = entries.find((e) => e.id === "content-what-to-send");
    const text = (entry?.approvedAnswerPoints ?? []).join(" ").toLowerCase();
    expect(text).toContain("perfiles de referencia");
    expect(text).toContain("guiones");
    expect(text).toContain("despues de la llamada");
  });
});
