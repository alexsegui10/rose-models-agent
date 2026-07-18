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
// RE-pregunta SUAVE del movil (2a vez) cuando la candidata aun no ha dado ningun aparato (p.ej. se fue a otro
// tema): se vuelve a pedir el movil con naturalidad, NO "marca y modelo exactamente" (que da por hecho que ya
// dio un movil y suena raro tras ignorar la pregunta; bug Alex 25-jun). Contiene "que movil tienes" para contar
// como pregunta del slot, pero NO casa el patron de aclaracion de modelo (no dispara el PENDING antes de tiempo).
const DEVICE_REASK = "Y al final que movil tienes? aunque sea solo la marca, asi veo la calidad de camara.";

// Cierre hacia la llamada (playbook 1.7): pitch -> la candidata propone dia/hora -> ENTONCES el
// telefono. Pedir el numero nada mas oir "llamada" era el fallo nº1 de la iteracion 1.
// jul-2026: la llamada es de TELEFONO normal (SIP, numero argentino) — ya NO "por WhatsApp" (pivote 29-jun).
// 17-jul (prueba real de Alex): se pedia "tu numero de WhatsApp" (era el mismo numero al que se llama y por
// ahi va luego el contrato), pero sonaba a que la LLAMADA era por WhatsApp. Alex: "eso quitalo, es una llamada
// normal". Se pide el numero de TELEFONO a secas; el contrato sigue yendo por WhatsApp a ese mismo numero.
export const PHONE_QUESTION = "Me puedes pasar tu numero de telefono?";
export const SCHEDULE_QUESTION = "Que dia y hora te viene bien para la llamada?";
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
    // AMPLIO a propósito (caso real Daiana 18-jul: el redactor REFORMULA la pregunta — "¿tienes cuenta de
    // only creada o no?" — y el patrón estrecho no la contaba, así que el tope anti-bucle nunca saltaba y
    // la pregunta salió 4 veces). OJO (revisor): sin "cuenta de" en la 1ª alternancia — la RESPUESTA del
    // propio bot "La cuenta de OnlyFans la abres tú" contaba como pregunta hecha y agotaba el cupo en
    // silencio (dead-end); la reformulación real la cubre la 3ª alternativa (cuenta de only + creada).
    alreadyAskedPattern:
      /(?:tienes|tenes|has tenido|tenido|tuviste)\s+(?:of|only|onlyfans)\b|(?:of|only|onlyfans)\b[^.?\n]{0,20}alguna vez|cuenta de only\w*\s+(?:creada|abierta|hecha)/,
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
    // Alex 6-jul: TODAS las candidatas son de Argentina, asi que el pais NUNCA se pregunta (molesta y no
    // aporta; la zona horaria se da por hecho: Argentina). isMissing SIEMPRE false -> el plan jamas lo pide,
    // ni siquiera como slot tardio (era el origen del "de que pais eres?" que se colaba hasta en el fallback).
    isMissing: () => false,
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

// SEGURIDAD (18-jul, bloqueante del revisor): el NO de menores debe salir tambien ante una AFIRMACION
// ("estaba pensando en salir con mi hija") — su ficha manda "jamas se defiere"; sin esto el turno caia al
// holding del socio, que suena a que se esta valorando. SOLO si el mensaje menciona menores/familia: la
// ficha comparte el tag generico "content" y hacerla respondible siempre la soltaba ante mensajes inocentes.
// "nen[ea]s?" a secas ("la nena sale conmigo"): el retriever ya surfacea la ficha para nena/nene sin el
// posesivo, y exigir "mi" aqui la bloqueaba (sonda del revisor). hijita/sobrina/beba quedan pendientes de
// unificar los 3 patrones de menores desincronizados (backlog, gap preexistente del retriever).
export const minorsMentionPattern = /\b(hij[oa]s?|nin[oa]s?|menor(?:es)?|bebes?|beba|nen[ea]s?|sobrin[oa]s?)\b/;

export function buildResponsePlan(input: BuildResponsePlanInput): ResponsePlan {
  const respondable = respondableEntries(input);
  const answerFacts = respondable.flatMap((entry) => entry.approvedAnswerPoints);
  const prohibitedClaims = input.knowledgeEntries.flatMap((entry) => entry.prohibitedClaims);
  const mandatoryNuances = input.knowledgeEntries.flatMap((entry) => entry.mandatoryNuances);
  // Una pregunta SIN cobertura en el PRIMER turno del lead NO escala (barrido 18-jul: el primer mensaje de
  // Daiana traia su historia + una pregunta rara y el bot salto a revision SIN NI SALUDAR — el opener es
  // "siempre, pase lo que pase"). Se saluda, el guion arranca, y si la re-pregunta despues escala normal.
  // Solo se difiere lo UNCOVERED: una ficha que exige revision, la negociacion (invariante 3) y las
  // escaladas del understanding (menor, inyeccion, distrust corroborado) siguen ganando al opener.
  const uncoveredQuestion = isBusinessQuestionWithoutCoverage(input) && !input.isOpenerTurn;
  const requiresHumanReview =
    input.knowledgeEntries.some((entry) => entry.requiresHumanReview) || uncoveredQuestion || isCommercialEscalation(input);

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
    hasApprovedNegotiationDecision: input.hasApprovedNegotiationDecision ?? false,
    // El Encaja de Alex es LA llave del agendado: sin humanFitDecision APPROVED, el validador factual
    // tumba cualquier propuesta de dia/hora (invariante 4; caso real Yesica 5-jul).
    callSchedulingAuthorized: input.candidate.humanFitDecision === "APPROVED"
  });
}

/**
 * Entradas que pueden usarse como respuesta AHORA: todas si hay pregunta real o intencion de
 * consulta; solo las de objecion si la candidata afirma algo sin preguntar. Evita responder
 * "no tengo fotos en el feed" con la politica de lanzamiento (volcado no solicitado).
 */
function respondableEntries(input: BuildResponsePlanInput): KnowledgeEntry[] {
  const message = normalize(input.inboundMessage);
  if (looksLikeQuestion(message)) return input.knowledgeEntries;
  if (ANSWER_WITH_FACTS_INTENTS.has(input.understanding.intent)) return input.knowledgeEntries;
  const mentionsMinors = minorsMentionPattern.test(message);
  return input.knowledgeEntries.filter(
    (entry) => entry.tags.some((tag) => OBJECTION_TAGS.has(tag)) || (mentionsMinors && entry.tags.includes("minors-content"))
  );
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
  // ¿La candidata DIVIRTIO preguntando otra cosa este turno (p.ej. el pago) en vez de responder al slot? Lo
  // usa la re-pregunta del movil: si divirtio y aun no dio aparato, se re-pregunta SUAVE, no "marca y modelo"
  // exactamente (que da por hecho que ya dio uno; bug Alex 25-jun). Señal: intent de pregunta/peticion o "?".
  const divertedWithQuestion = ANSWER_WITH_FACTS_INTENTS.has(intent) || /\?/.test(input.inboundMessage);
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
  // BUG A, ACOTADO (jul-2026, decision de Alex A0): el telefono capturado solo CIERRA las preguntas si el
  // guion ESENCIAL ya esta completo (ahi si: confirmar + derivar, sin reabrir nombre/OF — el BUG A original)
  // o si la candidata ya esta post-aprobacion. ANTES el gate era incondicional (`if (candidate.phone)`) y un
  // telefono soltado en el 2o mensaje (habitual en Argentina) mataba TODA la cualificacion: el bot dejaba de
  // preguntar OF/movil, prometia "lo hablo con mi socio" en bucle y el lead moria sin llegar nunca a
  // revision (hallazgo texto-01). Ahora: apunta el telefono y SIGUE cualificando lo que falte.
  const postApprovalState = [
    "APPROVED",
    "COLLECTING_CALL_DETAILS",
    "READY_TO_SCHEDULE",
    "CALL_SCHEDULED",
    "CALL_NO_ANSWER",
    "CALL_COMPLETED"
  ].includes(candidate.currentState);
  if (candidate.phone && (postApprovalState || essentialScriptDone(candidate))) return null;
  // LA LLAVE DEL ENCAJA (Alex 5-jul, caso real Yesica): el bot JAMAS propone dia/hora ni pide el numero
  // para la llamada sin humanFitDecision APPROVED. La regla vieja del 15-jun ("guion completo -> proponer
  // la llamada proactivamente") era ANTERIOR al diseño del Encaja y proponia la llamada en plena
  // cualificacion; Alex tuvo que frenar a Yesica a mano desde el CRM. El cierre de llamada lo abre SOLO
  // su decision (el reproceso del Encaja ya propone "Buenas noticias... ¿que dia y hora?").
  const fitApproved = candidate.humanFitDecision === "APPROVED";
  // En intervencion humana no se cualifica, pero cerrar la llamada (dia/hora y despues el numero)
  // no decide nada de negocio y es obligatorio en el guion real (se le olvido dos veces a Alex).
  if (candidate.currentState === "HUMAN_INTERVENTION_REQUIRED") {
    if (!adultConfirmed || candidate.phone || !confirmsCall || !fitApproved) return null;
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
    // A0 (jul-2026): mismo acotado que arriba — el telefono cierra SOLO con el guion esencial hecho (o
    // post-aprobacion); si llego pronto, se sigue con la pregunta esencial pendiente.
    if (candidate.phone) {
      if (postApprovalState || essentialScriptDone(candidate)) return null;
      return nextSlotQuestion(candidate, recentAgentMessages, { skipOptional: true, divertedWithQuestion });
    }
    // SIN el Encaja de Alex no se cierra llamada aunque ella la pida o proponga hora: se termina el
    // guion esencial y la revision decide (la llave del Encaja, Alex 5-jul).
    if (!fitApproved) {
      return nextSlotQuestion(candidate, recentAgentMessages, { skipOptional: true, divertedWithQuestion });
    }
    // Dia/hora concreto sobre la mesa: se pide el numero YA y no se reabre la cualificacion
    // (fallo real: "Como te llamas?" justo despues de recibir el telefono mataba el cierre).
    if (proposesTime) return askWithCap(PHONE_QUESTION, phoneAskPattern, recentAgentMessages);
    // Pide la llamada sin proponer momento: primero se termina el guion ESENCIAL; los slots
    // tardios opcionales (pais, disponibilidad) no bloquean el cierre y se cubren en la llamada
    // (regresion stall-loop iteracion 3, r14/r15). Si el guion esencial esta completo, que ella
    // proponga el dia y la hora (orden real: pitch -> dia/hora -> telefono).
    const slotQuestion = nextSlotQuestion(candidate, recentAgentMessages, { skipOptional: true, divertedWithQuestion });
    return slotQuestion ?? askWithCap(SCHEDULE_QUESTION, scheduleAskPattern, recentAgentMessages);
  }

  // Guion esencial completo (adulta + nombre + OF + movil) Y con el Encaja de Alex: se PROPONE el
  // dia/hora en vez de preguntar slots opcionales (pais, disponibilidad), que se cubren en la propia
  // llamada. SIN el Encaja (Alex 5-jul, caso Yesica) el guion completo desemboca en la revision del
  // socio, jamas en proponer la llamada: la regla vieja del 15-jun queda supersedida.
  if (adultConfirmed && essentialScriptDone(candidate) && fitApproved) {
    if (proposesTime) return askWithCap(PHONE_QUESTION, phoneAskPattern, recentAgentMessages);
    const scheduled = askWithCap(SCHEDULE_QUESTION, scheduleAskPattern, recentAgentMessages);
    if (scheduled) return scheduled;
  }

  return nextSlotQuestion(candidate, recentAgentMessages, { divertedWithQuestion });
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
  options: { skipOptional?: boolean; divertedWithQuestion?: boolean } = {}
): string | null {
  for (const slot of qualificationSlots) {
    if (options.skipOptional && slot.optional) continue;
    if (!slot.isMissing(candidate)) continue;
    // MOVIL: en vez de repetir la misma pregunta, la 2a vez se pide el MODELO EXACTO (Alex 23-jun). 1a vez:
    // pregunta normal; 2a vez (ya preguntado el movil y sigue sin modelo): aclaracion; 3a: nada (el motor ya
    // habra marcado PENDING tras la aclaracion, asi que normalmente el slot ya no esta missing aqui).
    if (slot.id === "device") {
      const deviceAsks = recentAgentMessages.filter((message) => /que movil tienes/.test(message)).length;
      const askedModel = recentAgentMessages.some((message) =>
        /marca y (?:el )?modelo|modelo de movil tienes exactamente/.test(message)
      );
      // 1a vez: pregunta normal del movil. Tras preguntarlo y SIN aparato nombrado:
      // - si en ESTE turno DIVIRTIO preguntando otra cosa (le estamos contestando hechos, p.ej. el pago):
      //   re-pregunta SUAVE el movil, NO "marca y modelo exactamente" (que da por hecho que ya dio uno y suena
      //   raro tras un "no contesto"; bug Alex 25-jun).
      // - si no pregunto nada (vago/ack o dio un tipo sin modelo): se pide el modelo exacto UNA vez -> el motor
      //   marca PENDING y el guion AVANZA (rompe el dead-end, Alex 23-jun). Tras pedir el modelo, no se repite.
      if (deviceAsks === 0) return slot.question;
      // Re-pregunta suave mientras divierta, pero con TOPE (deviceAsks < 3): si insiste en irse por las ramas
      // sin dar nunca el movil, se escala igual al modelo -> PENDING -> el guion AVANZA (no se reabre el
      // dead-end de Alex 23-jun ni se re-pregunta el movil en bucle infinito).
      if (options.divertedWithQuestion && deviceAsks < 3) return DEVICE_REASK;
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
      // "minimo el 50" / "minimo un 40" pegado a la pregunta del porcentaje es EXIGIR una cifra, no
      // preguntarla (revisor 4-jul: "q porcentaje, minimo el 50" recibia el 70/30 sin escalar).
      /\bminimo\s+(el\s+|un\s+)?\d{1,3}\b/.test(message) ||
      /\b\d{1,3}\s+para mi\b/.test(message) ||
      guaranteedMoneyDemandPattern.test(message) ||
      ((/\b\d{1,3}\s?%/.test(message) || /\b\d{1,2}\/\d{1,2}\b/.test(message)) && !/(70\s?%|30\s?%|70\/30)/.test(message)))
  );
}

function filterCommercialAnswerFacts(input: BuildResponsePlanInput, facts: string[]): string[] {
  const message = normalize(input.inboundMessage);
  // Preguntar la CIFRA del reparto ("que porcentaje os quedais?", "cuanto os llevais?", "cual es el
  // reparto?") SI se responde con el 70/30 (decision de Alex; invariante 3: solo si preguntan la cifra,
  // nunca proactivo). CAMBIO 4-jul (lanzamiento real): "¿que porcentaje?" a secas SI pide la cifra —
  // la exclusion conservadora de antes le costo un lead real (Mayra pregunto 'Que porcentaje' TRES
  // veces, recibio 'Okeyy' y se fue). Lo unico que sigue sin dar cifra es la pregunta del MODELO de
  // pago sin cifra pedida ("porcentaje o salario fijo?"), que no lleva "que porcentaje".
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
    // Preguntar la CIFRA del reparto, del lado agencia ("os quedais") o del PROPIO ("mi porcentaje",
    // "lo que gano yo", "cual es mi porcentaje"). jul-2026 (prueba E2E de Alba): "cual es mi porcentaje"
    // y "el que ganare yo" se clasificaban ASKS_ABOUT_PERCENTAGE pero el regex no los pillaba -> caian en
    // la rama general que REPETIA "no salario fijo" en vez de dar el 70/30 (antinatural, evasivo).
    // + "de cuanto seria/es el porcentaje" (barrido 18-jul noche: Ale lo pregunto SEIS veces con ese fraseo
    // natural, el detector no lo casaba y jamas recibio la cifra — el mismo modo de fallo de Mayra).
    /\b(cual es el (porcentaje|reparto)|como es el reparto|exacto|70\/30|quien recibe|quien se queda|os quedais|os qued|os llevais|os llev|cuanto os|que os qued|cuanto me llevo|cuanto me qued|cuanto me toca|cuanto saco|que me llevo|que me qued|cual es mi parte|cuanto es mi parte|cuanto gano|cuanto es para mi|me pagan|me pagarian|me pagaria|cuanto dinero me|cuanto cobro|mi porcentaje|porcentaje (para mi|mio)|el que (ganare|gano|gane|voy a ganar) yo|lo que (ganare|gano|voy a ganar|me llevo|me queda|me toca)|que me queda a mi|que me llevo yo|q(ue)? porcentaje|de cuanto (seria|es|va a ser|sera) (el )?(porcentaje|reparto)|cuanto (seria|es) (el|mi) (porcentaje|reparto)|porcentaje[^.?!]{0,15}para (mi|ustedes|vosotros)|mi ganancia|su comision|cual es (su|la) comision)\b/.test(
      message
    );
  const generalCommercialQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" ||
    /\b(salario|sueldo|porcentaje|reparto|cuanto cobra|comision|skrill|liquidacion)\b/.test(message);

  if (exactPercentageQuestion) {
    // Preguntó SU cifra: se responde con el 70/30 + justificación breve, y NADA MÁS. Se quita el
    // boilerplate de "no salario fijo" (Alex 3-jul: repetirlo cuando ya se dijo y no lo pregunta queda
    // antinatural — la cifra ya deja claro que no es salario). Si el recuperador no trajo el fact del
    // 70/30 (preguntas elípticas como "el que ganaré yo", sin la palabra "porcentaje"), se inyecta la
    // explicación autorizada. Invariante 3: la cifra solo sale aquí, cuando la pregunta es explícita.
    const withoutSalaryBoilerplate = facts.filter((fact) => !/\bsalario\b/i.test(fact));
    const hasFigure = withoutSalaryBoilerplate.some((fact) => /\b(70|30)\s?%|70\/30\b/.test(fact));
    const authorizedFigure =
      activeRevenueSharePolicy.approvedPercentageExplanation ?? "El reparto estandar es 70% para Rose Models y 30% para ti.";
    return hasFigure ? withoutSalaryBoilerplate : [authorizedFigure, ...withoutSalaryBoilerplate];
  }
  if (generalCommercialQuestion) return facts.filter((fact) => !/\b70%|30%|70\/30\b/i.test(fact));
  return facts.filter((fact) => !/\b(salario|porcentaje|reparto|econom|comercial|70%|30%)\b/i.test(fact));
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
