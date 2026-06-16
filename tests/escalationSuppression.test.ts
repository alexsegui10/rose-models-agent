import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import {
  ModelConversationOutputSchema,
  type ConversationUnderstandingProvider,
  type ModelConversationOutput
} from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function stubUnderstanding(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
  return ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData: {},
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: "",
    ...overrides
  });
}

function createEngineWithStub(outputs: ModelConversationOutput[]) {
  const repository = new InMemoryCandidateRepository();
  let callIndex = 0;
  const provider: ConversationUnderstandingProvider = {
    async understand() {
      const output = outputs[Math.min(callIndex, outputs.length - 1)];
      callIndex += 1;
      if (!output) throw new Error("Stub understanding output missing");
      return output;
    }
  };
  const engine = new ConversationEngine({ repository, understandingProvider: provider });
  return { engine, repository };
}

describe("escalation suppression allowlist (regresion de seguridad: solo se suprimen motivos benignos)", () => {
  it("keeps the coercion escalation when a third party controls the conversation", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: "Posible coaccion: un tercero controla la conversacion"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_coaccion",
      profileVisibility: "PUBLIC",
      message: "mi novio gestiona mis cuentas"
    });

    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("keeps the age-doubt escalation even when a clean adult age is extracted alongside the doubt", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "PROVIDES_AGE",
        extractedData: { age: 19 },
        requiresHumanReview: true,
        humanReviewReason: "Edad dudosa: afirma 19 pero dice que parece de 15"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_19_parece_15",
      profileVisibility: "PUBLIC",
      message: "tengo 19 jajaja aunque todos dicen que parezco de 15"
    });

    // Invariante 2: la duda de edad nunca se neutraliza en silencio, Alex tiene que verla.
    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.understanding.humanReviewReason).toContain("Edad dudosa");
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("keeps model escalations whose safety wording is outside the local lexicon", async () => {
    const reasons = [
      "Candidate seems underage",
      "Could be a minor, needs review",
      "Parece muy joven para el proceso",
      "Suena adolescente, mejor revisar",
      "Dice que todavia va al instituto"
    ];

    for (const humanReviewReason of reasons) {
      const { engine } = createEngineWithStub([
        stubUnderstanding({
          intent: "OTHER",
          extractedData: {},
          requiresHumanReview: true,
          humanReviewReason
        })
      ]);

      const result = await engine.handleIncomingMessage({
        instagramUsername: "lead_lexico_desconocido",
        profileVisibility: "PUBLIC",
        message: "ok pues"
      });

      expect(result.understanding.requiresHumanReview, humanReviewReason).toBe(true);
      expect(result.candidate.currentState, humanReviewReason).toBe("HUMAN_INTERVENTION_REQUIRED");
    }
  });

  it("records a suppressed benign escalation in the candidate notes instead of dropping it silently", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: { deviceType: "IPHONE", deviceModel: "iphone 13 pro max", deviceEligibility: "APPROVED" },
        requiresHumanReview: true,
        humanReviewReason: "Hay que validar el movil"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_iphone_traza",
      profileVisibility: "PUBLIC",
      message: "Tengo un iPhone 13 Pro Max"
    });

    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.candidate.notes).toContain("ESCALADA_SUPRIMIDA: Hay que validar el movil");
  });

  it("keeps an escalation without any stated reason (ambiguous is never benign)", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: null
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_sin_motivo",
      profileVisibility: "PUBLIC",
      message: "ok"
    });

    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});

describe("invariante 1: el modelo no inventa escaladas sin senal determinista", () => {
  it("suprime una escalada inventada por el modelo con motivo benigno y mensaje inofensivo, sin acabar en intervencion humana", async () => {
    // Motivo compuesto SOLO de vocabulario benigno del funnel (datos/perfil/proporcionados/completos):
    // el modelo "se inventa" la escalada sin ninguna senal determinista (ni edad dudosa, ni coaccion, ni
    // negociacion, ni prompt injection). Invariante 1: la salida del modelo no controla el flujo.
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: "El perfil tiene los datos completos"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_escalada_inventada_benigna",
      profileVisibility: "PUBLIC",
      message: "hola buenas, todo bien por aqui"
    });

    expect(result.understanding.requiresHumanReview).toBe(false);
    expect(result.understanding.humanReviewReason).toBeNull();
    expect(result.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    // La supresion nunca es silenciosa: Alex conserva el motivo original en las notas.
    expect(result.candidate.notes).toContain("ESCALADA_SUPRIMIDA: El perfil tiene los datos completos");
  });

  it("NO suprime una escalada del modelo con motivo generico vago: lo ambiguo nunca es benigno", async () => {
    // "Algo parece raro" / "No me da buena espina" no pertenecen al allowlist benigno (palabras fuera
    // del vocabulario cerrado), asi que la escalada se RESPETA: ante la duda, decide Alex, no el modelo.
    for (const humanReviewReason of ["Algo parece raro", "No me da buena espina"]) {
      const { engine } = createEngineWithStub([
        stubUnderstanding({
          intent: "OTHER",
          extractedData: {},
          requiresHumanReview: true,
          humanReviewReason
        })
      ]);

      const result = await engine.handleIncomingMessage({
        instagramUsername: "lead_motivo_vago",
        profileVisibility: "PUBLIC",
        message: "hola buenas, todo bien por aqui"
      });

      expect(result.understanding.requiresHumanReview, humanReviewReason).toBe(true);
      expect(result.candidate.currentState, humanReviewReason).toBe("HUMAN_INTERVENTION_REQUIRED");
      expect(result.candidate.notes, humanReviewReason).not.toContain(`ESCALADA_SUPRIMIDA: ${humanReviewReason}`);
    }
  });

  it("conserva la escalada cuando hay senal real de negociacion en el mensaje (caso de control)", async () => {
    // Caso de control: misma forma (escalada del modelo) pero el mensaje trae una senal determinista de
    // negociacion (porcentaje no estandar demandado). La negociacion SIEMPRE va a revision humana.
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "ASKS_ABOUT_PERCENTAGE",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: "Negocia el reparto"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_negociacion_control",
      profileVisibility: "PUBLIC",
      message: "quiero que me deis el 80% a mi"
    });

    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("conserva la escalada cuando hay senal de coaccion en el mensaje aunque el motivo del modelo sea benigno", async () => {
    // Caso de control reforzado: el motivo del modelo es benigno ("Datos completos"), pero el MENSAJE
    // contiene una senal de seguridad (un tercero controla las cuentas). La senal determinista del
    // mensaje manda sobre el motivo benigno: nunca se neutraliza una posible coaccion en silencio.
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: {},
        requiresHumanReview: true,
        humanReviewReason: "Datos completos"
      })
    ]);

    const result = await engine.handleIncomingMessage({
      instagramUsername: "lead_coaccion_motivo_benigno",
      profileVisibility: "PUBLIC",
      message: "mi novio controla mis cuentas"
    });

    expect(result.understanding.requiresHumanReview).toBe(true);
    expect(result.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(result.candidate.notes).not.toContain("ESCALADA_SUPRIMIDA: Datos completos");
  });
});

// Regresion del sobre-escalado real (medido con LLM): el modelo re-emite datos blandos o marcadores
// vacios en turnos posteriores, y la comprobacion de consistencia los tomaba como "contradiccion
// dura" -> HUMAN_INTERVENTION_REQUIRED pegajoso en cada turno benigno. Estos tests fallan sin el fix
// de dataConsistency (campos blandos = actualizacion, marcadores vacios y degradaciones a UNKNOWN
// se ignoran), mientras que un cambio real de EDAD sin correccion sigue escalando (operationalSafety).
describe("regresion sobre-escalado: re-extracciones benignas no son contradicciones duras", () => {
  it("does not escalate when the model re-emits a soft field with a different value (OF status flips)", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({ intent: "CONFIRMS_INTEREST", extractedData: { hasOnlyFans: true } }),
      stubUnderstanding({ intent: "OTHER", extractedData: { hasOnlyFans: false } })
    ]);

    const first = await engine.handleIncomingMessage({
      instagramUsername: "lead_of_flip",
      profileVisibility: "PUBLIC",
      message: "si tengo onlyfans"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "lead_of_flip",
      message: "bueno la tengo pero no la uso"
    });

    expect(second.contradictions).toHaveLength(0);
    expect(second.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("does not escalate when the model writes an empty marker into a previously known field", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({ intent: "OTHER", extractedData: { deviceModel: "iPhone 15", deviceType: "IPHONE" } }),
      stubUnderstanding({ intent: "OTHER", extractedData: { country: ":", city: "-", deviceModel: "," } })
    ]);

    const first = await engine.handleIncomingMessage({
      instagramUsername: "lead_marcador_vacio",
      profileVisibility: "PUBLIC",
      message: "tengo un iPhone 15"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "lead_marcador_vacio",
      message: "vale"
    });

    expect(second.contradictions).toHaveLength(0);
    expect(second.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    // El movil conocido no se pierde por culpa del marcador vacio.
    expect(second.candidate.deviceModel).toBe("iPhone 15");
  });

  it("does not escalate when a later turn downgrades a known device back to UNKNOWN", async () => {
    const { engine } = createEngineWithStub([
      stubUnderstanding({
        intent: "OTHER",
        extractedData: { deviceType: "IPHONE", deviceModel: "iPhone 13 pro max", deviceEligibility: "APPROVED" }
      }),
      stubUnderstanding({ intent: "OTHER", extractedData: { deviceType: "UNKNOWN", deviceEligibility: "UNKNOWN" } })
    ]);

    const first = await engine.handleIncomingMessage({
      instagramUsername: "lead_degradacion_unknown",
      profileVisibility: "PUBLIC",
      message: "iPhone 13 pro max"
    });
    const second = await engine.handleIncomingMessage({
      candidateId: first.candidate.id,
      instagramUsername: "lead_degradacion_unknown",
      message: "y no tengo suscriptores aun"
    });

    expect(second.contradictions).toHaveLength(0);
    expect(second.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
    // La degradacion a UNKNOWN no borra el dato ya conocido.
    expect(second.candidate.deviceType).toBe("IPHONE");
    expect(second.candidate.deviceEligibility).toBe("APPROVED");
  });
});
