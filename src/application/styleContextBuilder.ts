import { alexStyleProfile } from "@/content/style/alex-style-profile";
import type { Candidate, ConversationMessage, CandidateState } from "@/domain/candidate";
import type { ConversationExample } from "@/domain/conversationExample";
import type { KnowledgeEntry, ResponsePlan } from "@/domain/businessKnowledge";
import type { ConversationIntent, ModelConversationOutput } from "./llmProvider";

export interface StyleContextInput {
  candidate: Candidate;
  understanding: ModelConversationOutput;
  recentMessages: ConversationMessage[];
  retrievedExamples: ConversationExample[];
  knowledgeEntries: KnowledgeEntry[];
  responsePlan: ResponsePlan;
  allowedActions: string[];
  forbiddenActions: string[];
  immediateObjective: string;
}

export interface BuiltStyleContext {
  promptVersion: string;
  styleProfileVersion: string;
  rulesVersion: string;
  retrieverVersion: string;
  modelVersion: string;
  context: string;
}

export function buildStyleContext(input: StyleContextInput): BuiltStyleContext {
  const context = [
    "### BUSINESS_RULES",
    "La logica de negocio ya ha decidido estado, acciones permitidas y objetivo. La redaccion no puede cambiar estados.",
    "Responde primero a lo que la candidata acaba de decir o preguntar. Nunca repitas una pregunta que ya aparezca en RECENT_MESSAGES.",
    "",
    "### STYLE_PROFILE",
    `version: ${alexStyleProfile.version}`,
    `identidad: ${alexStyleProfile.identity.join(" | ")}`,
    `tono: ${alexStyleProfile.tone.join(", ")}`,
    `forma: ${alexStyleProfile.writingRules.join(" | ")}`,
    // El doble registro y los typos habituales SON identidad de Alex (decision 2026-06-10). Sin
    // surfacearlos al prompt la voz quedaba demasiado pulida (juez iteracion 1: "too polished").
    `registro_vivo: ${alexStyleProfile.registers.live.join(" | ")}`,
    `registro_plantilla: ${alexStyleProfile.registers.template.join(" | ")}`,
    `typos_habituales: ${alexStyleProfile.habitualTypos.join(" | ")}`,
    `muletillas: ${alexStyleProfile.signatureExpressions.join(" | ")}`,
    `prohibido: ${alexStyleProfile.forbiddenExpressions.join(" | ")}`,
    `evitar: ${alexStyleProfile.undesiredPatterns.join(" | ")}`,
    "",
    "### CURRENT_STATE",
    input.candidate.currentState,
    "",
    "### STRUCTURED_MEMORY",
    JSON.stringify(memoryForContext(input.candidate), null, 2),
    "",
    "### UNDERSTANDING",
    JSON.stringify(
      {
        intent: input.understanding.intent,
        confidence: input.understanding.confidence,
        requiresHumanReview: input.understanding.requiresHumanReview,
        humanReviewReason: input.understanding.humanReviewReason
      },
      null,
      2
    ),
    "",
    "### OFFICIAL_KNOWLEDGE",
    input.knowledgeEntries.map(formatKnowledgeForContext).join("\n\n"),
    "",
    "### RESPONSE_PLAN",
    JSON.stringify(
      {
        objective: input.responsePlan.objective,
        answerFacts: input.responsePlan.answerFacts,
        allowedClaims: input.responsePlan.allowedClaims,
        prohibitedClaims: input.responsePlan.prohibitedClaims,
        requiresHumanReview: input.responsePlan.requiresHumanReview,
        humanReviewReason: input.responsePlan.humanReviewReason,
        uncoveredQuestion: input.responsePlan.uncoveredQuestion
      },
      null,
      2
    ),
    "",
    "### RECENT_MESSAGES",
    input.recentMessages.map((message) => `${message.role}: ${message.content}`).join("\n"),
    "",
    "### RETRIEVED_EXAMPLES",
    input.retrievedExamples.map(formatExampleForContext).join("\n\n"),
    "",
    "### ALLOWED_ACTIONS",
    input.allowedActions.join(" | "),
    "",
    "### FORBIDDEN_ACTIONS",
    input.forbiddenActions.join(" | "),
    "",
    "### IMMEDIATE_OBJECTIVE",
    input.immediateObjective
  ].join("\n");

  return {
    promptVersion: alexStyleProfile.promptVersion,
    styleProfileVersion: alexStyleProfile.version,
    rulesVersion: alexStyleProfile.rulesVersion,
    retrieverVersion: alexStyleProfile.retrieverVersion,
    modelVersion: "deterministic-local-2026-06-08.1",
    context
  };
}

export function immediateObjectiveFor(state: CandidateState, intent: ConversationIntent, isOpenerTurn = false): string {
  if (state === "WAITING_PROFILE_ACCESS") return "Pedir que acepte la solicitud de seguimiento sin presionar.";
  if (state === "WAITING_HUMAN_REVIEW") return "Indicar que se comentara el perfil con el socio y que se respondera despues.";
  if (state === "HUMAN_INTERVENTION_REQUIRED")
    return "Hay un tema derivado al socio, pero responde IGUALMENTE a lo que la candidata pregunta usando el conocimiento oficial del plan. Usa 'lo hablo con mi socio' SOLO para lo que de verdad esta pendiente (agenda, condiciones). Nunca te despidas, nunca rechaces y nunca dejes de responder una pregunta con respuesta aprobada. Si confirma la llamada y falta el telefono, pidelo.";
  if (state === "CLOSED") return "Cerrar de forma educada y breve.";
  if (isOpenerTurn)
    return "Primer turno con la candidata: opener canonico de Alex en tres pasos (saludo + 'soy Alex de Rose Models', validar el perfil o pedir aceptar la solicitud de seguimiento, y el marco 'unas preguntas rapidas y luego una llamada'). PROHIBIDO hacer cualquier pregunta de cualificacion en este turno: espera a que ella acepte el marco.";
  if (intent === "REQUESTS_CALL")
    return "Aceptar la llamada como objetivo y avanzar hacia ella: si la edad esta confirmada, decir que lo hablas con tu socio para agendarla y pedir el numero de telefono si falta; si no, confirmar la edad primero.";
  if (intent === "PROVIDES_PHONE")
    return "Reconocer el telefono, decir que lo hablas con tu socio para la llamada y no repetir preguntas ya contestadas.";
  return "Avanzar la cualificacion con una sola pregunta principal: responde primero a lo que diga, sin volcar conocimiento que no ha pedido.";
}

function memoryForContext(candidate: Candidate): Record<string, string | number | boolean | null | string[]> {
  return {
    // El nombre conocido DEBE viajar en el contexto: sin el, el modelo re-preguntaba el nombre
    // (reset de funnel r14/r15) e inventaba la plantilla de rechazo "Si no quieres darme el nombre"
    // (r11/r12). Tambien habilita el acuse personalizado "Perfecto [nombre]".
    firstName: candidate.firstName ?? null,
    age: candidate.age ?? null,
    city: candidate.city ?? null,
    country: candidate.country ?? null,
    phone: candidate.phone ? "PROVIDED" : null,
    declaredProfileVisibility: candidate.declaredProfileVisibility,
    deviceEligibility: candidate.deviceEligibility,
    commercialTier: candidate.commercialTier,
    candidateClaimsFollowRequestAccepted: candidate.candidateClaimsFollowRequestAccepted,
    humanVerifiedProfileAccess: candidate.humanVerifiedProfileAccess,
    humanProfileReviewStatus: candidate.humanProfileReviewStatus,
    humanFitDecision: candidate.humanFitDecision,
    hasOnlyFans: candidate.hasOnlyFans ?? null,
    worksWithAnotherAgency: candidate.worksWithAnotherAgency ?? null,
    objections: candidate.objections
  };
}

function formatExampleForContext(example: ConversationExample): string {
  return [
    `EXAMPLE_ID: ${example.id}`,
    `CATEGORY: ${example.category}`,
    `TAGS: ${example.tags.join(", ")}`,
    `WHY_GOOD: ${example.whyItIsGood.join(" | ")}`,
    "MESSAGES:",
    example.messages.map((message) => `${message.role}: ${message.content}`).join("\n"),
    example.idealNextResponse ? `IDEAL_NEXT_RESPONSE: ${example.idealNextResponse}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function formatKnowledgeForContext(entry: KnowledgeEntry): string {
  return [
    `KNOWLEDGE_ID: ${entry.id}`,
    `CATEGORY: ${entry.category}`,
    `VERSION: ${entry.version}`,
    `FACTS: ${entry.facts.join(" | ")}`,
    `APPROVED_POINTS: ${entry.approvedAnswerPoints.join(" | ")}`,
    `MANDATORY_NUANCES: ${entry.mandatoryNuances.join(" | ")}`,
    `ESCALATION_CONDITIONS: ${entry.escalationConditions.join(" | ")}`,
    `PROHIBITED: ${entry.prohibitedClaims.join(" | ")}`
  ].join("\n");
}
