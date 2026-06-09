import { activeRevenueSharePolicy } from "@/content/business";
import type { Candidate } from "@/domain/candidate";
import { ResponsePlanSchema, type KnowledgeEntry, type ResponsePlan } from "@/domain/businessKnowledge";
import type { ModelConversationOutput } from "./llmProvider";

export interface BuildResponsePlanInput {
  candidate: Candidate;
  understanding: ModelConversationOutput;
  inboundMessage: string;
  knowledgeEntries: KnowledgeEntry[];
  hasApprovedNegotiationDecision?: boolean;
}

export function buildResponsePlan(input: BuildResponsePlanInput): ResponsePlan {
  const answerFacts = input.knowledgeEntries.flatMap((entry) => entry.approvedAnswerPoints);
  const prohibitedClaims = input.knowledgeEntries.flatMap((entry) => entry.prohibitedClaims);
  const mandatoryNuances = input.knowledgeEntries.flatMap((entry) => entry.mandatoryNuances);
  const requiresHumanReview = input.knowledgeEntries.some((entry) => entry.requiresHumanReview) || isBusinessQuestionWithoutCoverage(input) || isCommercialEscalation(input);
  const uncoveredQuestion = isBusinessQuestionWithoutCoverage(input);

  return ResponsePlanSchema.parse({
    objective: objectiveFor(input, requiresHumanReview, uncoveredQuestion),
    acknowledgedFacts: acknowledgedFactsFor(input),
    answerFacts: filterCommercialAnswerFacts(input, answerFacts),
    knowledgeEntryIds: input.knowledgeEntries.map((entry) => entry.id),
    allowedClaims: filterCommercialAnswerFacts(input, input.knowledgeEntries.flatMap((entry) => entry.facts)),
    prohibitedClaims,
    mandatoryNuances,
    questionToAsk: questionToAskFor(input.candidate),
    requiresHumanReview,
    humanReviewReason: requiresHumanReview ? humanReviewReasonFor(input, uncoveredQuestion) : null,
    allowedActions: requiresHumanReview ? ["PAUSE_FOR_HUMAN_REVIEW"] : ["ANSWER_WITH_APPROVED_FACTS", "ASK_QUALIFYING_QUESTION"],
    forbiddenActions: [
      "INVENT_BUSINESS_POLICY",
      "DISCLOSE_UNCONFIRMED_PERCENTAGE",
      "NEGOTIATE_BY_CHAT",
      "PROMISE_INCOME",
      "INVENT_CONTRACT_TERMS",
      "INVENT_SERVICES",
      "CLAIM_PROFILE_REVIEW_WITHOUT_CONFIRMATION"
    ],
    uncoveredQuestion,
    knowledgeVersions: input.knowledgeEntries.map((entry) => entry.version),
    revenueSharePolicyVersion: activeRevenueSharePolicy.version,
    hasApprovedNegotiationDecision: input.hasApprovedNegotiationDecision ?? false
  });
}

function objectiveFor(input: BuildResponsePlanInput, requiresHumanReview: boolean, uncoveredQuestion: boolean): string {
  if (uncoveredQuestion) return "Indicar que se consultara la pregunta porque no hay respuesta oficial activa.";
  if (requiresHumanReview) return "Responder solo con informacion autorizada y pausar para revision humana.";
  if (input.knowledgeEntries.length > 0) return "Responder la pregunta usando conocimiento oficial y avanzar el proceso con una sola pregunta.";
  return "Avanzar la cualificacion con una pregunta principal.";
}

function acknowledgedFactsFor(input: BuildResponsePlanInput): string[] {
  if (input.understanding.intent === "ASKS_ABOUT_PERCENTAGE") return ["La candidata pregunta por el reparto o porcentaje."];
  if (input.understanding.intent === "ASKS_ABOUT_CONTRACT") return ["La candidata pregunta por condiciones contractuales."];
  if (input.understanding.intent === "REQUESTS_CALL") return ["La candidata quiere una llamada."];
  return [];
}

function questionToAskFor(candidate: Candidate): string | null {
  if (!candidate.age) return "¿Que edad tienes?";
  if (!candidate.city && !candidate.country) return "¿En que ciudad estas ahora?";
  if (!candidate.experienceDescription && candidate.hasOnlyFans === undefined) return "¿Tienes experiencia creando contenido o gestionando redes?";
  return null;
}

function humanReviewReasonFor(input: BuildResponsePlanInput, uncoveredQuestion: boolean): string {
  if (uncoveredQuestion) return "OTHER";
  if (input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" && isCommercialEscalation(input)) return "PERCENTAGE_NEGOTIATION";
  if (input.understanding.intent === "ASKS_ABOUT_CONTRACT") return "CONTRACT_QUESTION";
  return "OTHER";
}

function isBusinessQuestionWithoutCoverage(input: BuildResponsePlanInput): boolean {
  const message = normalize(input.inboundMessage);
  if (!looksLikeQuestion(message)) return false;

  if (asksUnsupportedSpecificQuestion(message, input.knowledgeEntries)) return true;
  if (input.knowledgeEntries.length > 0) return false;

  return /\b(rose|agencia|vosotros|ustedes|contrato|porcentaje|sueldo|salario|servicio|llamada|contenido|modelo|mi parte|monetizacion|gestion|publicidad|impuestos|exclusividad)\b/.test(
    message
  );
}

function asksUnsupportedSpecificQuestion(message: string, knowledgeEntries: KnowledgeEntry[]): boolean {
  if (/\b(impuestos|fiscal|hacienda|publicidad|exclusividad)\b/.test(message)) return true;

  const asksModelResponsibility = /\b(que hago yo|que tendria que hacer yo|mi parte|modelo|enviar contenido|crear contenido)\b/.test(message);
  if (!asksModelResponsibility) return false;

  return !knowledgeEntries.some((entry) => entry.category === "CONTENT_RESPONSIBILITIES" && entry.status === "ACTIVE");
}

function looksLikeQuestion(message: string): boolean {
  return /[?¿]/.test(message) || /^\s*(que|como|cuanto|quien|donde|cuando|y que)\b/.test(message);
}

function isCommercialEscalation(input: BuildResponsePlanInput): boolean {
  const message = normalize(input.inboundMessage);

  return (
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" &&
    (/\b(me dais|dame|negociar|negociamos|excepcion|mejorar|bajar|subir|mas para mi)\b/.test(message) ||
      (/\b\d{1,3}\s?%/.test(message) && !/(70\s?%|30\s?%|70\/30)/.test(message)))
  );
}

function filterCommercialAnswerFacts(input: BuildResponsePlanInput, facts: string[]): string[] {
  const message = normalize(input.inboundMessage);
  const exactPercentageQuestion = input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" && /\b(cual|exacto|70\/30|quien recibe|quien se queda)\b/.test(message);
  const generalCommercialQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" || /\b(salario|sueldo|porcentaje|reparto|cuanto cobra|comision|skrill|liquidacion)\b/.test(message);

  if (exactPercentageQuestion) return facts;
  if (generalCommercialQuestion) return facts.filter((fact) => !/\b70%|30%|70\/30\b/i.test(fact));
  return facts.filter((fact) => !/\b(salario|porcentaje|reparto|econom|comercial|70%|30%)\b/i.test(fact));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
