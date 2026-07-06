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

  it("asks for the device (movil) after age, before OnlyFans (Alex 19-jun)", () => {
    const plan = planFor({ candidate: candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true }) });
    expect((plan.questionToAsk ?? "").toLowerCase()).toContain("que movil tienes");
    expect(plan.questionToAsk).not.toContain("ciudad");
  });

  it("asks OnlyFans after the device, then about other agencies (a las que tienen OF)", () => {
    const withDevice = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, deviceEligibility: "APPROVED" });
    expect((planFor({ candidate: withDevice }).questionToAsk ?? "").toLowerCase()).toContain("has tenido of");

    // Nuevo orden (Alex 19-jun): movil antes de OF, PERO si tiene OF agencias sigue formando parte del
    // guion esencial, asi que se pregunta antes de proponer la llamada (no se pierde la pregunta).
    const withOf = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      deviceEligibility: "APPROVED",
      hasOnlyFans: true
    });
    expect((planFor({ candidate: withOf }).questionToAsk ?? "").toLowerCase()).toContain("otras agencias");
  });

  it("no pregunta por agencias si la candidata no tiene OF (salta al movil)", () => {
    // Peticion de Alex 15-jun: si no tiene experiencia (sin OF), preguntar por agencias es redundante.
    const noOf = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, hasOnlyFans: false });
    const question = planFor({ candidate: noOf }).questionToAsk ?? "";
    expect(question.toLowerCase()).not.toContain("otras agencias");
    expect(question.toLowerCase()).toContain("que movil tienes");
  });

  // LA LLAVE DEL ENCAJA (Alex 5-jul, caso real Yesica): la regla del 15-jun ("guion completo -> proponer
  // la llamada") queda SUPERSEDIDA. Sin humanFitDecision APPROVED, el bot JAMAS propone dia/hora ni pide
  // el numero; el guion completo desemboca en la revision del socio.
  it("guion esencial completo SIN Encaja: JAMAS propone dia/hora ni pide telefono (Alex 5-jul)", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED"
    });
    const question = (planFor({ candidate }).questionToAsk ?? "").toLowerCase();
    expect(question).not.toContain("que dia y hora");
    expect(question).not.toContain("whatsapp");
    // Ni siquiera si ELLA propone una hora: el cierre lo abre el Encaja, no su propuesta.
    const withTime = planFor({ candidate, inboundMessage: "el lunes por la tarde me viene genial" });
    expect((withTime.questionToAsk ?? "").toLowerCase()).not.toContain("whatsapp");
  });

  it("CON el Encaja: guion completo propone la llamada, no pregunta el pais (mecanica del cierre intacta)", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      humanFitDecision: "APPROVED"
    });
    const question = planFor({ candidate }).questionToAsk ?? "";
    expect(question.toLowerCase()).toContain("que dia y hora");
    expect(question.toLowerCase()).not.toContain("pais");
    expect(question.toLowerCase()).not.toContain("disponibilidad");
  });

  it("CON el Encaja: si propone una hora con el guion completo, pide directamente el WhatsApp", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      humanFitDecision: "APPROVED"
    });
    const plan = planFor({ candidate, inboundMessage: "el lunes por la tarde me viene genial" });
    expect((plan.questionToAsk ?? "").toLowerCase()).toContain("numero de whatsapp");
  });
});

describe("responsePlanner no-repeat guard (mata el bucle degenerado de iteracion 1)", () => {
  it("moves to the next slot after asking the same question twice", () => {
    const plan = planFor({
      candidate: candidateWith({ firstName: "Carla" }),
      recentAgentMessages: ["Perfecto. Que edad tienes?", "Te leo. Que edad tienes?"]
    });
    // Tras saltar la edad (preguntada 2 veces), el siguiente slot del nuevo orden es el movil.
    expect((plan.questionToAsk ?? "").toLowerCase()).toContain("que movil tienes");
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
  // Actualizado 2026-07-06 (la llave del Encaja, caso Yesica): el cierre en HIR exige ademas
  // humanFitDecision APPROVED — sin el Encaja de Alex JAMAS se propone dia/hora ni se pide el numero.
  it("SIN Encaja en HIR: confirmar la llamada NO recibe dia/hora ni telefono (Alex 5-jul)", () => {
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
    expect(plan.questionToAsk).toBeNull();
  });

  it("CON Encaja: asks for the day and hour first when an adult confirms the call without proposing a time", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      humanFitDecision: "APPROVED"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, me gustaria hacer la llamada"
    });
    expect(plan.questionToAsk).toBe("Que dia y hora te viene bien para la llamada?");
  });

  it("CON Encaja: asks for the phone once the candidate proposes a concrete time", () => {
    const candidate = candidateWith({
      currentState: "HUMAN_INTERVENTION_REQUIRED",
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      humanFitDecision: "APPROVED"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Si, me gustaria hacer la llamada manana a las 11"
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de WhatsApp?");
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

  it("CON Encaja: asks for day and hour when the call is requested and the script is complete", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      humanFitDecision: "APPROVED",
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

  it("CON Encaja: asks for the phone as soon as the candidate proposes a concrete day or hour", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, humanFitDecision: "APPROVED" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "El domingo a las 11 am me viene bien"
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de WhatsApp?");
  });

  it("CON Encaja: treats a bare time proposal as call confirmation when the agent already proposed the call", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, humanFitDecision: "APPROVED" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Domingo 11 am?",
      recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de WhatsApp?");
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
    expect(plan.questionToAsk).not.toBe("Me puedes pasar tu numero de WhatsApp?");
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
      expect(plan.questionToAsk).not.toBe("Me puedes pasar tu numero de WhatsApp?");
    }
  });

  it("CON Encaja: still treats a real affirmative time ('manana a las 11 si') as a proposal", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, humanFitDecision: "APPROVED" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "manana a las 11 si",
      recentAgentMessages: ["Que dia y hora te viene bien para la llamada?"]
    });
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de WhatsApp?");
  });

  // Regresion del stall-loop de la iteracion 3 (r14-t7/t8, r15-t11/t12): con el si a la llamada
  // sobre la mesa, los slots tardios opcionales (pais, disponibilidad) NUNCA bloquean el cierre;
  // se cubren en la propia llamada.
  it("CON Encaja: skips the optional late slots and asks for day and hour once the call is confirmed", () => {
    const candidate = candidateWith({
      firstName: "Carla",
      age: 27,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceEligibility: "APPROVED",
      humanFitDecision: "APPROVED"
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
    expect(plan.questionToAsk).toBe("Me puedes contar si has tenido OF alguna vez?");
  });

  it("CON Encaja: never asks for the phone more than twice (anti acoso telefonico)", () => {
    const candidate = candidateWith({ firstName: "Carla", age: 27, isAdultConfirmed: true, humanFitDecision: "APPROVED" });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Hoy a las 18 mejor",
      recentAgentMessages: ["Me puedes pasar tu numero de WhatsApp?", "Pasame tu numero de telefono"]
    });
    expect(plan.questionToAsk).toBeNull();
  });

  // A0 (jul-2026): con guion esencial COMPLETO + telefono, no pregunta nada mas (BUG A intacto).
  it("asks nothing more when the call is requested, the phone is saved and the script is complete", () => {
    const candidate = candidateWith({
      age: 27,
      isAdultConfirmed: true,
      phone: "5491123456789",
      firstName: "Carla",
      hasOnlyFans: false,
      deviceEligibility: "APPROVED"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Cuando me llaman?"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  // BUG A, ACOTADO (jul-2026, decision de Alex A0 en el pre-lanzamiento): el telefono capturado solo
  // cierra el guion cuando el guion ESENCIAL esta completo (regresion BUG A original: no reabrir nombre/
  // slots tras el cierre) — pero un telefono soltado PRONTO ya NO mata la cualificacion (hallazgo
  // texto-01: el lead moria en bucle de "lo hablo con mi socio" sin llegar a revision).
  it("telefono PRONTO (guion esencial incompleto): SIGUE cualificando (decision A0)", () => {
    // Adulta con telefono pero sin OF/movil/nombre: el bot apunta el numero y pregunta lo que falta.
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
    expect(plan.questionToAsk).not.toBeNull();
  });

  it("BUG A intacto: guion esencial COMPLETO + telefono -> no reabre ninguna pregunta", () => {
    const candidate = candidateWith({
      age: 31,
      isAdultConfirmed: true,
      phone: "5491123456789",
      firstName: "Carla",
      hasOnlyFans: false,
      deviceEligibility: "APPROVED"
    });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "OTHER" }),
      inboundMessage: "Listo"
    });
    expect(plan.questionToAsk).toBeNull();
  });

  it("post-aprobacion + telefono -> tampoco re-cualifica aunque falten slots opcionales", () => {
    const candidate = candidateWith({
      currentState: "COLLECTING_CALL_DETAILS",
      age: 31,
      isAdultConfirmed: true,
      phone: "5491123456789"
    });
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
