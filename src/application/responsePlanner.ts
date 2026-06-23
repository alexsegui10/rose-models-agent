import { activeRevenueSharePolicy } from "@/content/business";
import { agencyProfileEntries } from "@/content/business/agency-profile";
import type { Candidate } from "@/domain/candidate";
import { ResponsePlanSchema, type KnowledgeEntry, type ResponsePlan } from "@/domain/businessKnowledge";
import { guaranteedMoneyDemandPattern } from "./dataExtractor";
import type { ModelConversationOutput } from "./llmProvider";

// Frases para responder PRIMERO a una pregunta personal/social de la candidata (decision de Alex 22-jun:
// responder siempre lo que pregunte y luego reconducir). IDENTITY reutiliza el conocimiento YA aprobado por
// Alex (agency-profile-rose-models), sin inventar nada. RECIPROCAL/GREETING son cortesia fija y segura: NUNCA
// inventan datos personales sensibles del bot (edad, ubicacion, estado civil) — invariante 5.
const IDENTITY_ANSWER =
  agencyProfileEntries
    .find((entry) => entry.id === "agency-profile-rose-models" && entry.status === "ACTIVE" && entry.approvedByAlex)
    ?.approvedAnswerPoints.join(" ") ?? "Soy Alex, de Rose Models.";
const RECIPROCAL_PERSONAL_ANSWER = "Jaja yo soy Alex, llevo la parte de la agencia.";
const GREETING_ANSWER = "Muy bien, gracias!";

function personalQuestionForPlan(input: BuildResponsePlanInput): ResponsePlan["pendingPersonalQuestion"] {
  const pending = input.understanding.pendingPersonalQuestion;
  if (!pending) return null;
  if (pending.kind === "IDENTITY") return { kind: "IDENTITY", answer: IDENTITY_ANSWER };
  if (pending.kind === "RECIPROCAL_PERSONAL") return { kind: "RECIPROCAL_PERSONAL", answer: RECIPROCAL_PERSONAL_ANSWER };
  return { kind: "GREETING", answer: GREETING_ANSWER };
}

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

// Re-pregunta del MOVIL (Alex 23-jun): si tras pedir el movil la candidata responde vago y SIN nombrar el
// aparato ("esta bien", "hago buenas fotos"), en vez de repetir identico se pide UNA vez el modelo exacto.
// Si tampoco asi lo da, el extractor marca el movil PENDING_QUALITY_TEST (Alex lo valora) y el guion avanza.
const DEVICE_MODEL_CLARIFICATION =
  "Que modelo de movil tienes exactamente? Dime la marca y el modelo, por ejemplo iPhone 13 o Samsung S23.";

// Cierre hacia la llamada (playbook 1.7): pitch -> la candidata propone dia/hora -> ENTONCES el
// telefono. Pedir el numero nada mas oir "llamada" era el fallo nº1 de la iteracion 1.
// La llamada de cierre se hace por WhatsApp (dato confirmado por Alex): se pide el numero de WhatsApp.
export const PHONE_QUESTION = "Me puedes pasar tu numero de WhatsApp?";
export const SCHEDULE_QUESTION = "Que dia y hora te viene bien para la llamada por WhatsApp?";
const phoneAskPattern = /pasa(?:me)?\s?tu numero|numero de (?:telefono|whatsapp)/;
const scheduleAskPattern = /que dia y hora/;
// Propuesta de momento concreto (dia, hora o "cuando quieras") en el mensaje de la candidata.
const timeProposalPattern =
  /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|hoy|manana|mediodia|tarde|noche|madrugada|ahora)\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s?(?:am|pm|hs|h|horas)\b|\ba las \d{1,2}\b|\bcuando (?:quieras|quieran|puedas|puedan|sea)\b/;
// Rechazo del momento propuesto ("no ahora", "ahora no", "hoy no", "manana no me viene bien"): la
// palabra de tiempo va negada y NO es una propuesta. Sin esto, "no ahora no" disparaba "Pasame tu
// numero" y mataba leads vivos (taxonomia nº1/nº6 iteracion 2, r3 T14).
const negatedTimePattern =
  /\bno\b[^.!?]{0,12}\b(ahora|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|mediodia)\b|\b(ahora|hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|tarde|noche|mediodia)\b[^.!?]{0,15}\bno\b/;

/** Una propuesta de momento real: hay palabra de tiempo y no esta negada. */
export function proposesConcreteTime(message: string): boolean {
  return timeProposalPattern.test(message) && !negatedTimePattern.test(message);
}

interface QualificationSlot {
  id: string;
  question: string;
  alreadyAskedPattern: RegExp;
  isMissing: (candidate: Candidate) => boolean;
  /** Slot tardio opcional (pais, disponibilidad): nunca bloquea el cierre de la llamada. */
  optional?: boolean;
}

// Orden del guion (decision de Alex 19-jun): nombre -> edad -> MOVIL -> OF -> agencias. El movil va ANTES
// de OF para filtrar pronto por calidad de camara (movil no apto = no seguir). "En que ciudad estas" NO
// existe en el guion real; el pais queda como pregunta tardia opcional.
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
    // Movil ANTES de OF/agencias (decision de Alex 19-jun): filtra pronto por calidad de camara.
    id: "device",
    // Dos mensajes (la pregunta + el porque), no un parrafo largo: mas natural (peticion de Alex 22-jun).
    question: "Y que movil tienes?\n\nEs importante para la calidad de las fotos y los videos.",
    alreadyAskedPattern: /que movil tienes/,
    // Cinturon y tirantes (Alex 23-jun): si ya hay un MODELO de movil en el Candidate, el slot NO esta missing
    // aunque la elegibilidad fuera UNKNOWN -> NUNCA se re-pregunta un movil ya contestado (el motor re-deriva la
    // elegibilidad del modelo via loop-break). Una candidata nueva (sin modelo) si recibe la pregunta del movil.
    isMissing: (candidate) =>
      candidate.deviceEligibility === "UNKNOWN" &&
      !(typeof candidate.deviceModel === "string" && candidate.deviceModel.trim().length > 0)
  },
  {
    id: "onlyfans-or-experience",
    // Registro mas calido (peticion de Alex 15-jun): nada de pregunta fria a secas.
    question: "Me puedes contar si has tenido OF alguna vez?",
    alreadyAskedPattern: /tienes of|has tenido of|tienes onlyfans|has tenido onlyfans/,
    // Solo depende de si SABEMOS si tiene OnlyFans: una experienceDescription (a veces alucinada por
    // el LLM desde un mensaje de parloteo) NO dice si tiene OF, asi que no debe saltarse esta pregunta.
    isMissing: (candidate) => candidate.hasOnlyFans === undefined
  },
  {
    id: "agencies",
    question: "Has trabajado alguna vez con otras agencias?",
    alreadyAskedPattern: /otras? agencias?/,
    // Solo se pregunta por agencias a quien SI ha tenido OF: si no tiene experiencia, preguntar por
    // agencias es redundante (peticion de Alex 15-jun: "si dijo que no tiene experiencia, por que le
    // pregunta por agencias"). Para las inexpertas, el pitch proactivo cubre el "como trabajamos".
    isMissing: (candidate) => candidate.worksWithAnotherAgency === undefined && candidate.hasOnlyFans === true
  },
  {
    id: "country",
    question: "Por cierto, de que pais eres?",
    alreadyAskedPattern: /que pais eres|en que ciudad/,
    isMissing: (candidate) => !candidate.country && !candidate.city,
    optional: true
  },
  {
    id: "availability",
    // Reformulado al registro de Alex (juez iteracion 3): nada de "disponibilidad ... crear
    // contenido durante la semana" corporativo.
    question: "Cuanto tiempo le podrias dedicar a esto a la semana?",
    alreadyAskedPattern: /cuanto tiempo le podrias dedicar|que disponibilidad/,
    isMissing: (candidate) => !candidate.contentAvailability && !candidate.goals,
    optional: true
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

  // La pregunta personal/social solo se inyecta si el turno NO escala ni tiene respuesta de NEGOCIO ni es de
  // una MENOR: la seguridad (invariantes 2/3/4) y el conocimiento de negocio siempre ganan. Invariante 2: si la
  // candidata es (o acaba de declararse) menor de 18, el turno cierra por edad y JAMAS se responde lo social.
  const isMinor =
    (typeof input.candidate.age === "number" && input.candidate.age < 18) ||
    (typeof input.understanding.extractedData.age === "number" && input.understanding.extractedData.age < 18);
  const pendingPersonalQuestion =
    isMinor || requiresHumanReview || uncoveredQuestion || answerFacts.length > 0 ? null : personalQuestionForPlan(input);

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
    pendingPersonalQuestion,
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
  const acks: string[] = [];
  // Si acaba de dar su edad y es adulta, reconocerlo BREVE y con calidez antes de lo demas (Alex 22-jun:
  // responder a TODO lo que dijo, en orden; p.ej. "tengo 30 / os sirve? / cuanto pagais?" -> "genial, con 30
  // perfecto" antes del reparto). Ortogonal al % (no menciona cifras), no afecta a la validacion factual.
  const age = input.understanding.extractedData.age;
  if (typeof age === "number" && age >= 18 && age <= 99) {
    acks.push(
      `La candidata acaba de decir su edad (${age}) y es valida: confirmaselo brevemente y con calidez antes de responder lo demas.`
    );
  }
  if (input.understanding.intent === "ASKS_ABOUT_PERCENTAGE") acks.push("La candidata pregunta por el reparto o porcentaje.");
  else if (input.understanding.intent === "ASKS_ABOUT_CONTRACT")
    acks.push("La candidata pregunta por condiciones contractuales.");
  else if (input.understanding.intent === "REQUESTS_CALL") acks.push("La candidata quiere una llamada.");
  return acks;
}

/**
 * Decide la UNICA pregunta principal del turno, o ninguna.
 * Reglas: nada de preguntas en el turno del opener canonico ni antes del gate de perfil, ni en
 * escalados/revision humana; orden canonico de slots; cap anti-bucle de 2 intentos por pregunta.
 * Cierre hacia la llamada (playbook 1.7): si la candidata propone un dia/hora concreto se pide
 * SIEMPRE el numero; si solo pide la llamada, primero se termina el guion y despues el dia/hora.
 */
function questionToAskFor(
  input: BuildResponsePlanInput,
  requiresHumanReview: boolean,
  uncoveredQuestion: boolean
): string | null {
  const candidate = input.candidate;
  const intent = input.understanding.intent;
  const message = normalize(input.inboundMessage);
  const recentAgentMessages = (input.recentAgentMessages ?? []).map(normalize);
  const adultConfirmed = Boolean(candidate.age && candidate.isAdultConfirmed);
  const proposesTime = proposesConcreteTime(message);
  // El "Domingo 11 am?" suelto tras proponer el agente la llamada ES una confirmacion de llamada,
  // aunque el modelo clasifique OTHER (fallo real: se perdia la propuesta de hora de la candidata).
  // Solo cuenta el ULTIMO mensaje del agente: un "manana" suelto turnos despues no es una hora.
  const lastAgentMessage = recentAgentMessages[recentAgentMessages.length - 1] ?? "";
  const agentProposedCall = /llamada|dia y hora/.test(lastAgentMessage);
  const confirmsCall =
    intent === "REQUESTS_CALL" ||
    intent === "PROVIDES_PHONE" ||
    input.understanding.requestsCall ||
    (agentProposedCall && proposesTime);

  if (requiresHumanReview || uncoveredQuestion) return null;
  // Opener canonico (primer turno de un lead nuevo): presentacion + gate/marco, sin preguntas.
  if (input.isOpenerTurn && candidate.currentState === "NEW_LEAD") return null;
  if (candidate.age && candidate.age < 18) return null;
  // BUG A (replay-1 T22, replay-3 T15, replay-14 T9): una vez capturado el telefono el funnel NO
  // se reabre. Sin esto el planner seguia pidiendo slots pendientes (OF, agencias, movil) o incluso
  // el nombre, reiniciando el guion despues de tener el dato que cierra la conversacion hacia la
  // llamada. El cierre (confirmar + derivar al socio) lo redacta el motor; aqui solo se silencia
  // cualquier pregunta de cualificacion. No debilita ninguna escalada: si el turno requiere humano
  // ya retorno null arriba.
  if (candidate.phone) return null;
  // En intervencion humana no se cualifica, pero cerrar la llamada (dia/hora y despues el numero)
  // no decide nada de negocio y es obligatorio en el guion real (se le olvido dos veces a Alex).
  if (candidate.currentState === "HUMAN_INTERVENTION_REQUIRED") {
    if (!adultConfirmed || candidate.phone || !confirmsCall) return null;
    return proposesTime
      ? askWithCap(PHONE_QUESTION, phoneAskPattern, recentAgentMessages)
      : askWithCap(SCHEDULE_QUESTION, scheduleAskPattern, recentAgentMessages);
  }
  if (
    candidate.currentState === "CLOSED" ||
    candidate.currentState === "REJECTED" ||
    candidate.currentState === "WAITING_HUMAN_REVIEW"
  ) {
    return null;
  }
  if (profileGatePending(candidate)) return null;

  // Una llamada sin edad confirmada no avanza (invariante 2): la edad pasa por delante del nombre.
  if (confirmsCall && !candidate.age) {
    const ageSlot = qualificationSlots.find((slot) => slot.id === "age");
    if (ageSlot) {
      const capped = askWithCap(ageSlot.question, ageSlot.alreadyAskedPattern, recentAgentMessages);
      if (capped) return capped;
    }
  }

  if (adultConfirmed && confirmsCall) {
    if (candidate.phone) return null;
    // Dia/hora concreto sobre la mesa: se pide el numero YA y no se reabre la cualificacion
    // (fallo real: "Como te llamas?" justo despues de recibir el telefono mataba el cierre).
    if (proposesTime) return askWithCap(PHONE_QUESTION, phoneAskPattern, recentAgentMessages);
    // Pide la llamada sin proponer momento: primero se termina el guion ESENCIAL; los slots
    // tardios opcionales (pais, disponibilidad) no bloquean el cierre y se cubren en la llamada
    // (regresion stall-loop iteracion 3, r14/r15). Si el guion esencial esta completo, que ella
    // proponga el dia y la hora (orden real: pitch -> dia/hora -> telefono).
    const slotQuestion = nextSlotQuestion(candidate, recentAgentMessages, { skipOptional: true });
    return slotQuestion ?? askWithCap(SCHEDULE_QUESTION, scheduleAskPattern, recentAgentMessages);
  }

  // Guion esencial completo (adulta + nombre + OF + movil): el opener prometio "luego agendamos una
  // llamada", asi que se PROPONE el dia/hora de forma proactiva en vez de preguntar slots opcionales
  // (pais, disponibilidad), que se cubren en la propia llamada (peticion de Alex 15-jun: tras explicar,
  // agendar; nada de "de que pais eres?" justo despues del pitch).
  if (adultConfirmed && essentialScriptDone(candidate)) {
    if (proposesTime) return askWithCap(PHONE_QUESTION, phoneAskPattern, recentAgentMessages);
    const scheduled = askWithCap(SCHEDULE_QUESTION, scheduleAskPattern, recentAgentMessages);
    if (scheduled) return scheduled;
  }

  return nextSlotQuestion(candidate, recentAgentMessages);
}

/**
 * Guion esencial completo: nombre, EDAD ADULTA confirmada, si tiene OF y el movil. A partir de aqui el
 * bot agenda la llamada (no pregunta pais/disponibilidad proactivamente). Espejo de essentialScriptComplete
 * del motor; se mantiene local para no acoplar capas (el motor importa del planner, no al reves).
 */
function essentialScriptDone(candidate: Candidate): boolean {
  // Con el movil ya temprano (antes de OF, orden de Alex 19-jun), la pregunta de agencias forma parte del
  // guion esencial SOLO si tiene OF (a las que ya trabajan Alex les pregunta por agencias); si no tiene OF,
  // agencias se omite y no bloquea. Asi el movil va antes de OF PERO la pregunta de agencias sigue siendo
  // alcanzable antes de proponer la llamada (si no, al saber movil+OF se agendaba y agencias no se pedia).
  const agenciesResolved = candidate.hasOnlyFans !== true || candidate.worksWithAnotherAgency !== undefined;
  return (
    Boolean(candidate.firstName) &&
    Boolean(candidate.age) &&
    candidate.isAdultConfirmed &&
    candidate.hasOnlyFans !== undefined &&
    candidate.deviceEligibility !== "UNKNOWN" &&
    agenciesResolved
  );
}

function nextSlotQuestion(
  candidate: Candidate,
  recentAgentMessages: string[],
  options: { skipOptional?: boolean } = {}
): string | null {
  for (const slot of qualificationSlots) {
    if (options.skipOptional && slot.optional) continue;
    if (!slot.isMissing(candidate)) continue;
    // MOVIL: en vez de repetir la misma pregunta, la 2a vez se pide el MODELO EXACTO (Alex 23-jun). 1a vez:
    // pregunta normal; 2a vez (ya preguntado el movil y sigue sin modelo): aclaracion; 3a: nada (el motor ya
    // habra marcado PENDING tras la aclaracion, asi que normalmente el slot ya no esta missing aqui).
    if (slot.id === "device") {
      const askedDevice = recentAgentMessages.some((message) => /que movil tienes/.test(message));
      const askedModel = recentAgentMessages.some((message) =>
        /marca y (?:el )?modelo|modelo de movil tienes exactamente/.test(message)
      );
      if (!askedDevice) return slot.question;
      if (!askedModel) return DEVICE_MODEL_CLARIFICATION;
      continue;
    }
    const capped = askWithCap(slot.question, slot.alreadyAskedPattern, recentAgentMessages);
    if (capped) return capped;
  }
  return null;
}

function askWithCap(question: string, alreadyAskedPattern: RegExp, recentAgentMessages: string[]): string | null {
  // El opener (que ya pide el nombre) NO consume el cupo anti-bucle del planner: el cap existe para
  // limitar las RE-preguntas del planner, no la primera del opener. Sin esto, ante mensajes vagos
  // ("mmm", "aja") el bot abandonaba el nombre demasiado pronto y saltaba a la edad (hallazgo jueces 15-jun).
  const timesAsked = recentAgentMessages.filter(
    (message) => alreadyAskedPattern.test(message) && !/rose models/.test(message)
  ).length;
  return timesAsked >= MAX_SAME_QUESTION_ASKS ? null : question;
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

  // Solo formulaciones en primera persona sobre SU parte del trabajo. La palabra "modelo" suelta
  // ("como promocionan a la modelo?") mandaba el pitch operativo al socio (fallo real replay-6).
  const asksModelResponsibility =
    /\b(que hago yo|que tendria que hacer yo|que tengo que hacer yo|que me toca|mi parte)\b/.test(message) ||
    /\b(enviar|mandar|crear|grabar)\b[^.!?]{0,25}\bcontenido\b/.test(message);
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
    (/\b(me dais|dame|negociar|negociamos|excepcion|mejora\w*|baj[ae]\w*|sub[ei]\w*|mas para mi)\b/.test(message) ||
      // Pedir una cifra para SI MISMA sin "%" ("quiero el 50", "quiero un 40", "quiero ganar mas", "50 para
      // mi") es negociacion -> revision, no una pregunta de cifra a la que se responda 70/30 (invariante 3).
      /\bquiero\s+(el\s+|un\s+)?\d{1,3}\b/.test(message) ||
      /\bquiero\s+(ganar\s+)?mas\b/.test(message) ||
      /\b\d{1,3}\s+para mi\b/.test(message) ||
      guaranteedMoneyDemandPattern.test(message) ||
      ((/\b\d{1,3}\s?%/.test(message) || /\b\d{1,2}\/\d{1,2}\b/.test(message)) && !/(70\s?%|30\s?%|70\/30)/.test(message)))
  );
}

function filterCommercialAnswerFacts(input: BuildResponsePlanInput, facts: string[]): string[] {
  const message = normalize(input.inboundMessage);
  // Preguntar la CIFRA del reparto ("que porcentaje os quedais?", "cuanto os llevais?", "cual es el
  // reparto?") SI se responde con el 70/30 (decision de Alex; invariante 3: solo si preguntan la cifra,
  // nunca proactivo). OJO: una pregunta del MODELO de pago ("porcentaje o salario fijo?", "que
  // porcentaje es?") NO pide el reparto -> sin cifra; por eso NO basta con que aparezca "porcentaje".
  // Incluye la pregunta por la PROPIA parte ("cuanto me llevo yo", "mi parte", "como es el reparto"): es
  // pedir la cifra exacta (la suya = 30/70), asi que SI se responde con el 70/30 (invariante 3 — solo si
  // preguntan la cifra). Antes solo se cubria el lado-agencia ("os quedais") y se le ocultaba a quien
  // preguntaba lo suyo.
  // Tambien la pregunta directa de PAGO en PRIMERA PERSONA ("cuanto me pagan", "cuanto dinero me pagan",
  // "cuanto gano/cobro yo") pide su cifra y se responde con 70/30 (Alex 22-jun): el extractor ya la cuenta
  // como ASKS_ABOUT_PERCENTAGE pero el planner la dejaba caer en la rama general que OCULTABA el reparto. Se
  // exige el "me"/primera persona a proposito: la pregunta VAGA "cuanto pagan?" (sin "me") sigue dando la
  // respuesta sin-cifra (invariante 3 conservador). La negociacion (pedir mas, regatear, cifra no estandar)
  // escala antes via isCommercialEscalation -> requiresHumanReview, asi que esto no la toca.
  const exactPercentageQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" &&
    // Una NEGOCIACION nunca libera la cifra (gana el escalado): aunque el mensaje tambien parezca pregunta
    // de pago ("cuanto me pagan? quiero el 50 para mi"), se trata como negociacion -> revision (invariante 3).
    !isCommercialEscalation(input) &&
    /\b(cual es el (porcentaje|reparto)|como es el reparto|exacto|70\/30|quien recibe|quien se queda|os quedais|os qued|os llevais|os llev|cuanto os|que os qued|cuanto me llevo|cuanto me qued|cuanto me toca|cuanto saco|que me llevo|que me qued|cual es mi parte|cuanto es mi parte|cuanto gano|cuanto es para mi|me pagan|me pagarian|me pagaria|cuanto dinero me|cuanto cobro)\b/.test(
      message
    );
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
