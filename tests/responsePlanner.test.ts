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
  it("asks for the phone when an adult confirms the call while waiting on the socio", () => {
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

  it("asks for the phone number when an adult candidate requests the call", () => {
    const candidate = candidateWith({ age: 27, isAdultConfirmed: true });
    const plan = planFor({
      candidate,
      understanding: understandingWith({ intent: "REQUESTS_CALL", requestsCall: true }),
      inboundMessage: "Podemos hacer la llamada?",
      knowledgeEntries: [entryById("call-details-after-review")]
    });
    expect(plan.requiresHumanReview).toBe(false);
    expect(plan.questionToAsk).toBe("Me puedes pasar tu numero de telefono?");
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
