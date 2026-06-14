import { describe, expect, it } from "vitest";
import { buildResponsePlan, type BuildResponsePlanInput } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ModelConversationOutput } from "@/application/llmProvider";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, type Candidate } from "@/domain/candidate";

function candidateWith(overrides: Partial<Candidate> = {}): Candidate {
  return {
    ...createCandidate({ instagramUsername: "planner_case", profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING",
    ...overrides
  };
}

function understandingWith(overrides: Partial<ModelConversationOutput> = {}): ModelConversationOutput {
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

function planFor(input: Partial<BuildResponsePlanInput> = {}) {
  return buildResponsePlan({
    candidate: candidateWith(),
    understanding: understandingWith(),
    inboundMessage: "Hola",
    knowledgeEntries: [],
    ...input
  });
}

function entryById(id: string) {
  const entry = businessKnowledgeEntries.find((item) => item.id === id);
  if (!entry) throw new Error(`Knowledge entry ${id} not found`);
  return entry;
}

describe("responsePlanner question slots (orden canonico del guion real)", () => {
  it("asks for the name first when nothing is known (el Alex real siempre abre con el nombre)", () => {
    expect(planFor().questionToAsk).toBe("Como te llamas?");
  });

  it("asks for the age once the name is known", () => {
    expect(planFor({ candidate: candidateWith({ firstName: "Carla" }) }).questionToAsk).toBe("Que edad tienes?");
  });

  it("asks for OnlyFans after age, never the city question", () => {
    const plan = planFor({ candidate: candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true }) });
    expect(plan.questionToAsk).toBe("Tienes of o has tenido alguna vez?");
    expect(plan.questionToAsk).not.toContain("ciudad");
  });

  it("asks about other agencies after OnlyFans, then the device", () => {
    const base = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, hasOnlyFans: true });
    expect(planFor({ candidate: base }).questionToAsk).toContain("otras agencias");

    const withAgencies = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false
    });
    expect(planFor({ candidate: withAgencies }).questionToAsk).toContain("que movil tienes");
  });

  it("asks the country late and only when device is already known", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED"
    });
    expect(planFor({ candidate }).questionToAsk).toBe("Por cierto, de que pais eres?");
  });

  // El "Que disponibilidad tendrias para crear contenido durante la semana?" corporativo no existe
  // en el canon de Alex (juez iteracion 3): la pregunta de tiempo se reformula en su registro.
  it("asks availability with Alex-like phrasing, never the corporate wording", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      country: "Argentina"
    });
    const plan = planFor({ candidate });
    expect(plan.questionToAsk).toBe("Cuanto tiempo le podrias dedicar a esto a la semana?");
    expect(plan.questionToAsk).not.toContain("disponibilidad");
  });
});

describe("responsePlanner no-repeat guard (mata el bucle degenerado de iteracion 1)", () => {
  it("moves to the next slot after asking the same question twice", () => {
    const plan = planFor({
      candidate: candidateWith({ firstName: "Carla" }),
      recentAgentMessages: ["Perfecto. Que edad tienes?", "Te leo. Que edad tienes?"]
    });
    expect(plan.questionToAsk).toBe("Tienes of o has tenido alguna vez?");
  });

  it("asks nothing when every pending slot was already asked twice", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      country: "Argentina",
      contentAvailability: "Por las tardes"
    });
    const plan = planFor({
      candidate,
      recentAgentMessages: ["Que edad tienes?", "Que edad tienes?"]
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("still asks once and twice before giving up", () => {
    const askedOnce = planFor({
      candidate: candidateWith({ firstName: "Carla" }),
      recentAgentMessages: ["Que edad tienes?"]
    });
    expect(askedOnce.questionToAsk).toBe("Que edad tienes?");
  });
});

describe("responsePlanner opener turn (gate-first: nada de preguntas antes del opener canonico)", () => {
  it("asks nothing on the very first agent turn of a new lead", () => {
    const candidate = candidateWith({ currentState: "NEW_LEAD" });
    const plan = planFor({ candidate, isOpenerTurn: true });
    expect(plan.questionToAsk).toBeNull();
  });

  it("asks normally on later turns of the same lead", () => {
    const candidate = candidateWith({ currentState: "QUALIFYING" });
    const plan = planFor({ candidate, isOpenerTurn: false });
    expect(plan.questionToAsk).toBe("Como te llamas?");
  });

  it("does not suppress questions for seeded mid-funnel candidates outside NEW_LEAD", () => {
    const candidate = candidateWith({ currentState: "QUALIFYING", firstName: "Carla" });
    const plan = planFor({ candidate, isOpenerTurn: true });
    expect(plan.questionToAsk).toBe("Que edad tienes?");
  });
});

describe("responsePlanner phone ask in HUMAN_INTERVENTION_REQUIRED (playbook 1.7)", () => {
  // Actualizado 2026-06-12: el test anterior validaba el comportamiento BUGGY (pedir el numero
  // sin dia/hora acordado). El guion real es pitch -> dia/hora -> telefono.
  it("asks for the day and hour first when an adult confirms the call without proposing a time", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, me gustaria hacer la llamada"
    });
    expect(plan.questionToAsk).toBe("Que dia y hora te viene bien para la llamada?");
  });

  it("asks for the phone once the candidate proposes a concrete time while waiting on the socio", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, me gustaria hacer la llamada manana a las 11"
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de telefono?");
  });

  it("asks nothing in HUMAN_INTERVENTION_REQUIRED when the phone is already saved", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      phone: "5491123456789"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Cuando me llaman?"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("never asks qualification slots while in HUMAN_INTERVENTION_REQUIRED", () => {
    const candidate = candidateWith({ currentState: "HUMAN_INTERVENTION_REQUIRED" });
    const plan = planFor({ candidate, inboundMessage: "Vale" });
    expect(plan.questionToAsk).toBeNull();
  });
});

describe("responsePlanner question gating", () => {
  it("asks nothing before the profile gate is accepted", () => {
    const candidate = candidateWith({
      currentState: "NEW_LEAD",
      declaredProfileVisibility: "PRIVATE",
      humanVerifiedProfileAccess: false,
      candidateClaimsFollowRequestAccepted: false
    });
    expect(planFor({ candidate }).questionToAsk).toBeNull();
  });

  it("asks nothing when the turn escalates to human review", () => {
    const plan = planFor({
      understanding: understandingWith({ intent: "ASKS_ABOUT_CONTRACT" }),
      inboundMessage: "El contrato tiene permanencia?"
    });
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.questionToAsk).toBeNull();
  });

  // Actualizado 2026-06-12: pedir el numero nada mas oir "llamada" era el fallo nº1 de los jueces
  // (acoso telefonico prematuro). El orden real: guion -> dia/hora -> telefono.
  it("keeps the qualification script when the call is requested without a time and slots are missing", () => {
    const candidate = candidateWith({ age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Podemos hacer la llamada?",
      knowledgeEntries: [entryById("call-details-after-review")]
    });
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.questionToAsk).toBe("Como te llamas?");
  });

  it("asks for day and hour when the call is requested and the script is complete", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      country: "Argentina",
      contentAvailability: "Por las tardes"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Podemos hacer la llamada?",
      knowledgeEntries: [entryById("call-details-after-review")]
    });
    expect(plan.questionToAsk).toBe("Que dia y hora te viene bien para la llamada?");
  });

  it("asks for the phone as soon as the candidate proposes a concrete day or hour", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "El domingo a las 11 am me viene bien"
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de telefono?");
  });

  it("treats a bare time proposal as call confirmation when the agent already proposed the call", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Domingo 11 am?",
      recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de telefono?");
  });

  // Regresion taxonomia nº1/nº6 iteracion 2 (r3 T14, lead-killing): "no ahora no" tras proponer
  // la llamada es un RECHAZO del momento, no una propuesta de hora. Disparar "Pasame tu numero"
  // ahi mataba leads vivos. Una hora negada nunca cuenta como propuesta de momento.
  it("does not treat a negated time ('no ahora no') as a time proposal after the agent proposed the call", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "UNCLEAR" }),
      inboundMessage: "no ahora no",
      recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
    });
    expect(plan.questionToAsk).not.toBe("Me puedes pasar tu numero de telefono?");
  });

  it("does not treat 'ahora no puedo' or 'hoy no' as a concrete time proposal", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    for (const message of ["ahora no puedo", "hoy no", "manana no me viene bien"]) {
      const plan = planFor({
        candidate,
        understanding: understandingWith({ intent: "UNCLEAR" }),
        inboundMessage: message,
        recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
      });
      expect(plan.questionToAsk).not.toBe("Me puedes pasar tu numero de telefono?");
    }
  });

  it("still treats a real affirmative time ('manana a las 11 si') as a proposal", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "manana a las 11 si",
      recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de telefono?");
  });

  // Regresion del stall-loop de la iteracion 3 (r14-t7/t8, r15-t11/t12): con el si a la llamada
  // sobre la mesa, los slots tardios opcionales (pais, disponibilidad) NUNCA bloquean el cierre;
  // se cubren en la propia llamada.
  it("skips the optional late slots and asks for day and hour once the call is confirmed", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED"
      // pais y disponibilidad ausentes a proposito: no deben preguntarse aqui
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, hagamos la llamada"
    });
    expect(plan.questionToAsk).toBe("Que dia y hora te viene bien para la llamada?");
  });

  it("still finishes the essential script (OF pendiente) before scheduling the call", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, hagamos la llamada"
    });
    expect(plan.questionToAsk).toBe("Tienes of o has tenido alguna vez?");
  });

  it("never asks for the phone more than twice (anti acoso telefonico)", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Hoy a las 18 mejor",
      recentAgentMessages: ["Me puedes pasar tu numero de telefono?", "Pasame tu numero de telefono"]
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("asks nothing more when the call is requested and the phone is already saved", () => {
    const candidate = candidateWith({ age: 27, isAdultConfirmed: true, phone: "5491123456789" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Cuando me llaman?"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  // Regresion BUG A (replay-1 T22, replay-3 T15, replay-14 T9): una vez capturado el telefono de
  // una adulta confirmada, el bot NUNCA reabre el guion de cualificacion (nombre, edad, slots).
  // Antes seguia preguntando slots pendientes y reiniciaba el funnel.
  it("never reopens qualification slots once the phone is captured for an adult (QUALIFYING)", () => {
    // Candidata adulta con telefono pero con slots aun pendientes (sin OF, sin agencias, sin movil):
    // el telefono cierra el guion, no se vuelve a preguntar nada.
    const candidate = candidateWith({
      age: 31,
      isAdultConfirmed: true,
      phone: "5491123456789"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Si"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("never asks the name again after the phone is captured even if firstName is still empty", () => {
    const candidate = candidateWith({ age: 31, isAdultConfirmed: true, phone: "5491123456789" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Listo"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("never asks slots once the phone is captured in HUMAN_INTERVENTION_REQUIRED", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      age: 31,
      isAdultConfirmed: true,
      phone: "5491123456789"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Si gracias"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("keeps asking the age before any call when age is unknown", () => {
    const plan = planFor({
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Llamame y lo vemos"
    });
    expect(plan.questionToAsk).toBe("Que edad tienes?");
  });
});

describe("responsePlanner knowledge dumping guard", () => {
  it("does not volunteer non-objection knowledge for plain statements", () => {
    const plan = planFor({
      knowledgeEntries: [entryById("launch-timeline")],
      inboundMessage: "No tengo fotos en el feed"
    });
    expect(plan.answerFacts).toHaveLength(0);
    expect(plan.knowledgeEntryIds).toContain("launch-timeline");
  });

  it("answers the same knowledge when the candidate actually asks", () => {
    const plan = planFor({
      knowledgeEntries: [entryById("launch-timeline")],
      inboundMessage: "Cuanto tarda el lanzamiento?"
    });
    expect(plan.answerFacts.length).toBeGreaterThan(0);
  });

  it("keeps objection knowledge usable for statements (geo privacy)", () => {
    const plan = planFor({
      knowledgeEntries: [entryById("geo-privacy-three-layers")],
      inboundMessage: "No quiero que me vean en Argentina"
    });
    expect(plan.answerFacts.length).toBeGreaterThan(0);
  });
});

// FIX 2 (sobre-escalado): el modelo en vivo a veces clasifica "Cual es el proceso de seleccion?"
// como ASKS_ABOUT_CONTRACT, lo que arrastraba la entrada contract-questions-human-review (HIR) y
// escalaba una pregunta benigna. Una pregunta generica de proceso/seleccion/como-funciona se
// RESPONDE con faq-selection-process; solo las dudas contractuales GENUINAS (permanencia, clausula,
// firmar, exclusividad, terminos legales) escalan.
describe("responsePlanner generic process question does not over-escalate as contract (FIX 2)", () => {
  it("answers the selection-process question instead of escalating, even when the model labels it ASKS_ABOUT_CONTRACT", () => {
    const plan = planFor({
      candidate: candidateWith(),
      understanding: understandingWith({ intent: "ASKS_ABOUT_CONTRACT" }),
      inboundMessage: "Cual es el proceso de seleccion?",
      knowledgeEntries: [entryById("faq-selection-process")]
    });
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.uncoveredQuestion).toBe(false);
    expect(plan.knowledgeEntryIds).toContain("faq-selection-process");
    expect(plan.answerFacts.length).toBeGreaterThan(0);
  });

  it("answers a generic 'como funciona el proceso' question without escalating", () => {
    const plan = planFor({
      candidate: candidateWith(),
      understanding: understandingWith({ intent: "ASKS_ABOUT_CONTRACT" }),
      inboundMessage: "Como funciona el proceso de revision?",
      knowledgeEntries: [entryById("faq-selection-process")]
    });
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.uncoveredQuestion).toBe(false);
  });

  it("STILL escalates a genuine permanence contract question to human review", () => {
    const plan = planFor({
      candidate: candidateWith(),
      understanding: understandingWith({ intent: "ASKS_ABOUT_CONTRACT" }),
      inboundMessage: "El contrato tiene permanencia?",
      knowledgeEntries: [entryById("contract-questions-human-review")]
    });
    expect(plan.requiresHumanReview).toBe(true);
    expect(plan.humanReviewReason).toBe("CONTRACT_QUESTION");
  });

  it("STILL escalates a genuine exclusivity-clause contract question to human review", () => {
    const plan = planFor({
      candidate: candidateWith(),
      understanding: understandingWith({ intent: "ASKS_ABOUT_CONTRACT" }),
      inboundMessage: "Hay alguna clausula de exclusividad en el contrato que tengo que firmar?",
      knowledgeEntries: [entryById("contract-questions-human-review")]
    });
    // "exclusividad" es una pregunta especifica sin cobertura: escala (reason OTHER), pero escala.
    expect(plan.requiresHumanReview).toBe(true);
  });
});
