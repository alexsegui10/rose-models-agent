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
  /** Mensajes recientes del agente, en orden cronologico. Alimentan el guard anti-repeticion. */
  recentAgentMessages?: string[];
  /**
   * Primer turno del agente con un lead nuevo: el opener canonico (presentacion + gate/marco)
   * va SIEMPRE antes de cualquier pregunta de cualificacion (invariante del guion real).
   */
  isOpenerTurn?: boolean;
}

/** Una misma pregunta de cualificacion nunca se repite mas de 2 veces (el Alex real tampoco lo hace). */
const MAX_SAME_QUESTION_ASKS = 2;

interface QualificationSlot {
  id: string;
  question: string;
  alreadyAskedPattern: RegExp;
  isMissing: (candidate: Candidate) => boolean;
}

// Orden canonico del guion real de Alex (analisis 2026-06-10): nombre -> edad -> OF -> agencias -> movil.
// "En que ciudad estas" NO existe en el guion real; el pais queda como pregunta tardia opcional.
const qualificationSlots: QualificationSlot[] = [
  {
    id: "name",
    question: "Como te llamas?",
    alreadyAskedPattern: /como te llamas|cual es tu nombre|te llamas .+ verdad/,
    isMissing: (candidate) => !candidate.firstName
  },
  {
    id: "age",
    question: "Que edad tienes?",
    alreadyAskedPattern: /que edad tienes|cuantos anos tienes/,
    isMissing: (candidate) => !candidate.age
  },
  {
    id: "onlyfans-or-experience",
    question: "Tienes of o has tenido alguna vez?",
    alreadyAskedPattern: /tienes of|has tenido of|tienes onlyfans|has tenido onlyfans/,
    isMissing: (candidate) => candidate.hasOnlyFans === undefined && !candidate.experienceDescription
  },
  {
    id: "agencies",
    question: "Has trabajado alguna vez con otras agencias?",
    alreadyAskedPattern: /otras? agencias?/,
    isMissing: (candidate) => candidate.worksWithAnotherAgency === undefined
  },
  {
    id: "device",
    question: "Y que movil tienes? Es importante para la calidad de fotos y videos.",
    alreadyAskedPattern: /que movil tienes/,
    isMissing: (candidate) => candidate.deviceEligibility === "UNKNOWN"
  },
  {
    id: "country",
    question: "Por cierto, de que pais eres?",
    alreadyAskedPattern: /que pais eres|en que ciudad/,
    isMissing: (candidate) => !candidate.country && !candidate.city
  },
  {
    id: "availability",
    question: "Que disponibilidad tendrias para crear contenido durante la semana?",
    alreadyAskedPattern: /que disponibilidad/,
    isMissing: (candidate) => !candidate.contentAvailability && !candidate.goals
  }
];

const ANSWER_WITH_FACTS_INTENTS = new Set<ModelConversationOutput["intent"]>([
  "ASKS_ABOUT_PERCENTAGE",
  "ASKS_ABOUT_CONTRACT",
  "REQUESTS_INFORMATION",
  "REQUESTS_CALL"
]);

// Etiquetas de entradas que SI pueden responderse ante una afirmacion (objecion declarada),
// aunque la candidata no formule pregunta. El resto solo se responde si hay pregunta real:
// evita los volcados de conocimiento no solicitados (cara, plazos, cadencia...).
const OBJECTION_TAGS = new Set([
  "objection",
  "distrust",
  "scam",
  "anger",
  "multi-agency",
  "market-conflict",
  "geo-privacy",
  "country-block",
  "face",
  "anonymity",
  "boundaries"
]);

export function buildResponsePlan(input: BuildResponsePlanInput): ResponsePlan {
  const respondable = respondableEntries(input);
  const answerFacts = respondable.flatMap((entry) => entry.approvedAnswerPoints);
  const prohibitedClaims = input.knowledgeEntries.flatMap((entry) => entry.prohibitedClaims);
  const mandatoryNuances = input.knowledgeEntries.flatMap((entry) => entry.mandatoryNuances);
  const requiresHumanReview =
    input.knowledgeEntries.some((entry) => entry.requiresHumanReview) ||
    isBusinessQuestionWithoutCoverage(input) ||
    isCommercialEscalation(input);
  const uncoveredQuestion = isBusinessQuestionWithoutCoverage(input);

  return ResponsePlanSchema.parse({
    objective: objectiveFor(input, requiresHumanReview, uncoveredQuestion, respondable.length > 0),
    acknowledgedFacts: acknowledgedFactsFor(input),
    answerFacts: filterCommercialAnswerFacts(input, answerFacts),
    knowledgeEntryIds: input.knowledgeEntries.map((entry) => entry.id),
    allowedClaims: filterCommercialAnswerFacts(
      input,
      respondable.flatMap((entry) => entry.facts)
    ),
    prohibitedClaims,
    mandatoryNuances,
    questionToAsk: questionToAskFor(input, requiresHumanReview, uncoveredQuestion),
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

/**
 * Entradas que pueden usarse como respuesta AHORA: todas si hay pregunta real o intencion de
 * consulta; solo las de objecion si la candidata afirma algo sin preguntar. Evita responder
 * "no tengo fotos en el feed" con la politica de lanzamiento (volcado no solicitado).
 */
function respondableEntries(input: BuildResponsePlanInput): KnowledgeEntry[] {
  if (looksLikeQuestion(normalize(input.inboundMessage))) return input.knowledgeEntries;
  if (ANSWER_WITH_FACTS_INTENTS.has(input.understanding.intent)) return input.knowledgeEntries;
  return input.knowledgeEntries.filter((entry) => entry.tags.some((tag) => OBJECTION_TAGS.has(tag)));
}

function objectiveFor(
  input: BuildResponsePlanInput,
  requiresHumanReview: boolean,
  uncoveredQuestion: boolean,
  hasRespondableKnowledge: boolean
): string {
  if (uncoveredQuestion) return "Indicar que se consultara la pregunta porque no hay respuesta oficial activa.";
  if (requiresHumanReview) return "Responder solo con informacion autorizada y pausar para revision humana.";
  if (hasRespondableKnowledge)
    return "Responder la pregunta usando conocimiento oficial y avanzar el proceso con una sola pregunta.";
  return "Avanzar la cualificacion con una pregunta principal.";
}

function acknowledgedFactsFor(input: BuildResponsePlanInput): string[] {
  if (input.understanding.intent === "ASKS_ABOUT_PERCENTAGE") return ["La candidata pregunta por el reparto o porcentaje."];
  if (input.understanding.intent === "ASKS_ABOUT_CONTRACT") return ["La candidata pregunta por condiciones contractuales."];
  if (input.understanding.intent === "REQUESTS_CALL") return ["La candidata quiere una llamada."];
  return [];
}

/**
 * Decide la UNICA pregunta principal del turno, o ninguna.
 * Reglas: nada de preguntas en el turno del opener canonico ni antes del gate de perfil, ni en
 * escalados/revision humana; orden canonico de slots; cap anti-bucle de 2 intentos por pregunta;
 * si la candidata pide llamada o da telefono con edad confirmada, la pregunta pasa a ser el
 * numero de telefono (playbook 1.7: al confirmar la llamada se pide SIEMPRE el numero).
 */
function questionToAskFor(
  input: BuildResponsePlanInput,
  requiresHumanReview: boolean,
  uncoveredQuestion: boolean
): string | null {
  const candidate = input.candidate;
  const intent = input.understanding.intent;
  const adultConfirmed = Boolean(candidate.age && candidate.isAdultConfirmed);
  const confirmsCall = intent === "REQUESTS_CALL" || intent === "PROVIDES_PHONE" || input.understanding.requestsCall;

  if (requiresHumanReview || uncoveredQuestion) return null;
  // Opener canonico (primer turno de un lead nuevo): presentacion + gate/marco, sin preguntas.
  if (input.isOpenerTurn && candidate.currentState === "NEW_LEAD") return null;
  if (candidate.age && candidate.age < 18) return null;
  // En intervencion humana no se cualifica, pero pedir el numero al confirmar la llamada no
  // decide nada de negocio y es obligatorio en el guion real (se le olvido dos veces a Alex).
  if (candidate.currentState === "HUMAN_INTERVENTION_REQUIRED") {
    return adultConfirmed && confirmsCall && !candidate.phone ? "Me puedes pasar tu numero de telefono?" : null;
  }
  if (
    candidate.currentState === "CLOSED" ||
    candidate.currentState === "REJECTED" ||
    candidate.currentState === "WAITING_HUMAN_REVIEW"
  ) {
    return null;
  }
  if (profileGatePending(candidate)) return null;

  if (adultConfirmed && confirmsCall) {
    return candidate.phone ? null : "Me puedes pasar tu numero de telefono?";
  }

  const recentAgentMessages = (input.recentAgentMessages ?? []).map(normalize);

  // Una llamada sin edad confirmada no avanza (invariante 2): la edad pasa por delante del nombre.
  if (confirmsCall && !candidate.age) {
    const ageSlot = qualificationSlots.find((slot) => slot.id === "age");
    if (ageSlot) {
      const timesAsked = recentAgentMessages.filter((message) => ageSlot.alreadyAskedPattern.test(message)).length;
      if (timesAsked < MAX_SAME_QUESTION_ASKS) return ageSlot.question;
    }
  }

  for (const slot of qualificationSlots) {
    if (!slot.isMissing(candidate)) continue;
    const timesAsked = recentAgentMessages.filter((message) => slot.alreadyAskedPattern.test(message)).length;
    if (timesAsked >= MAX_SAME_QUESTION_ASKS) continue;
    return slot.question;
  }

  return null;
}

function profileGatePending(candidate: Candidate): boolean {
  return (
    candidate.declaredProfileVisibility === "PRIVATE" &&
    !candidate.humanVerifiedProfileAccess &&
    !candidate.candidateClaimsFollowRequestAccepted
  );
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

  const asksModelResponsibility =
    /\b(que hago yo|que tendria que hacer yo|mi parte|modelo|enviar contenido|crear contenido)\b/.test(message);
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
  const exactPercentageQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" &&
    /\b(cual|exacto|70\/30|quien recibe|quien se queda)\b/.test(message);
  const generalCommercialQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" ||
    /\b(salario|sueldo|porcentaje|reparto|cuanto cobra|comision|skrill|liquidacion)\b/.test(message);

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
