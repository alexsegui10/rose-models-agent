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
  // Solo se reconoce la edad si NO se ha reconocido YA en un mensaje reciente del agente (barrido terra
  // 18-jul: el bot soltaba "34 perfecto, por la edad sin problema" DOS veces — la 2ª cuando el modelo
  // re-extraia la edad del contexto). Si ya se aco, no se re-inyecta el ack.
  const ageAlreadyAcked =
    typeof age === "number" &&
    (input.recentAgentMessages ?? []).some((message) => {
      const m = normalize(message);
      return m.includes(`${age}`) && /\b(perfecto|sin problema|por (la )?edad|genial)\b/.test(m);
    });
  if (typeof age === "number" && age >= 18 && age <= 99 && !ageAlreadyAcked) {
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

// NEGOCIACION del reparto detectada por el FRASEO, independiente del intent del LLM (revisor 19-jul): el gate
// viejo exigia intent === "ASKS_ABOUT_PERCENTAGE", pero el clasificador determinista etiqueta "se puede negociar
// la parte de la agencia?" o "no podeis bajar la parte de la agencia?" como UNCLEAR/OTHER -> se colaban como
// pregunta de cifra y recibian el 70/30 SIN escalar (fuga del invariante 3: negociacion -> revision humana). Un
// "?" no distingue "pregunta la cifra" de "pide negociarla". Se detectan verbos de REGATEO inequivocos, y
// terminos direccionales/de objecion de precio ANCLADOS a la parte/reparto/porcentaje/comision.
function negotiatesRevenueShare(message: string): boolean {
  // Verbos de REGATEO inequivocos (negocian en cualquier contexto, no hace falta anclarlos).
  if (/\b(negoci\w+|regate\w+|rebaj\w+|descuent\w+|abarat\w+)\b/.test(message)) return true;
  // Un reparto EXPLICITO con barra/guion que no sea 70/30 ("40/60", "50-50", "85/15") es una propuesta =
  // negociacion. Se comprueba CADA par por separado: antes se excluia si "70/30" aparecia en CUALQUIER parte del
  // mensaje, asi que "el 70/30 me parece un monton, haceme 85/15" se escapaba porque llevaba "70/30" (fuga inv 3
  // del /loop 20-jul, caso Vanina). Ahora escala si ALGUN par propuesto no es 70/30.
  const slashSplits = message.match(/\b\d{1,2}\s*[\/-]\s*\d{1,2}\b/g) ?? [];
  if (slashSplits.some((s) => !/^70\s*[\/-]\s*30$/.test(s.trim()) && !/^30\s*[\/-]\s*70$/.test(s.trim()))) return true;
  // PEDIR MAS para si misma anclado al dinero ("quiero ganar mas", "mas plata/dinero/porcentaje para mi", "un
  // poco mas para mi", "la mitad para mi"): negociacion aunque tambien pregunte la cifra en el mismo turno
  // (compuestos que cazo el revisor). Anclado a dinero para no chocar con "quiero saber mas / mas info".
  if (
    /\b(ganar|llevarme|quedarme con|sacar|cobrar|llevar) mas\b|\bmas (?:plata|dinero|porcentaje|guita|pasta)\b|\b(?:un poco |algo |bastante )?mas para mi\b|\b(?:quiero|pido|dame|denme|deme|me quedo con|prefiero|quisiera|me gustaria|exijo|pretendo) (?:al menos |como minimo |minimo )?la mitad\b|\bla mitad para mi\b/.test(
      message
    )
  )
    return true;
  // El resto solo cuenta si la frase TOCA el reparto/parte/porcentaje/comision de la agencia. Incluye la parte
  // de la agencia en 3a persona ("lo que SE llevan / SE quedan"), no solo 2a ("os llevais"), y los sinonimos
  // "split" / "division de la plata" / "como se reparte" (si no, una contrapropuesta formulada con "split" no
  // anclaba y filtraba la cifra por la via determinista: compuestos del revisor "como es el split, dejenme 40").
  const shareTerm =
    /\b(la parte (?:de la agencia|vuestra|suya)|mi parte|el porcentaje|del porcentaje|el reparto|del reparto|vuestra comision|su comision|la comision|os qued\w+|os llev\w+|se qued\w+|se llev\w+|split|division de (?:la plata|el dinero|lo que se gana)|como se reparte)\b/;
  if (!shareTerm.test(message)) return false;
  // PROPONER numeros concretos del reparto que no sean 70/30 ("me dejan el 40 y se quedan con 60", "50 y 50",
  // "50 50"): negociacion aunque venga como pregunta y la IA la clasifique FIGURE. Ya dentro del contexto de
  // reparto (shareTerm), un par de numeros adyacentes (con "y", espacio o pegados) es una propuesta de reparto.
  const proposesNonStandardSplit =
    (/\b\d{1,2}(?:\s+y\s+|\s+)\d{1,2}\b/.test(message) && !/\b(70(?:\s+y\s+|\s+)30|30(?:\s+y\s+|\s+)70)\b/.test(message)) ||
    ((message.match(/\b\d{1,2}\b/g) ?? []).some((x) => x !== "70" && x !== "30") &&
      /\b(me (?:dejan|dejen|dejaban|dan|daban|den|dais|deis|quedo|quede|llevo|lleve|quedaria|daria|dejaria|das|da|dejas|dejais)|dejenme|denme|deme|dame|dejarme|darme|se quedan con|se lleven|se lleve|para mi|nos quedamos|me quedo con)\b/.test(
        message
      ));
  if (proposesNonStandardSplit) return true;
  // Verbos/comparativos de subir o bajar el importe: son ACCIONES sobre la cifra, no adjetivos ambiguos, asi
  // que son seguros anclados al reparto. "mejor" solo en forma con flexion (mejora/mejorar/mejores), nunca el
  // ADVERBIO suelto ("explicame mejor el reparto" es aclaracion -> se responde). "menor" (no "menos", que casa
  // la muletilla "mas o menos" = aproximadamente -> falso positivo del revisor).
  if (/\b(baj\w+|sub\w+|reduc\w+|aument\w+|increment\w+|mejor(?:a|e)\w*|menor|mas para mi|mas alt\w*)\b/.test(message))
    return true;
  // OBJECION DE PRECIO: "es/parece + (caro/mucho/demasiado/alto/excesivo/abusivo/injusto/un abuso/una locura)".
  // Se exige la COPULA/verbo delante (es/son/me parece/...) para NO disparar "la cara" (=rostro, colision
  // car[oa]/cara) ni "muchas gracias"; y solo cuenta tras el shareTerm (arriba). "demasiado/mucho" cuentan como
  // objecion por si solos ("es demasiado lo que se llevan"), no solo como intensificador (fuga del fuzz IA).
  if (
    /\b(?:es|son|me parece|parece|parecen|se me hace|sale|salen|resulta\w*)\s+(?:re |muy |super |tan |bastante |medio |un |una )?(?:car[oa]s?|much[oa]|muchisim\w+|demasiad\w+|alt[oa]s?|elevad[oa]s?|exager\w+|abusiv\w+|excesiv\w+|carisim\w+|injust\w+|abuso|locura|robo|monton|montonazo)\b/.test(
      message
    ) ||
    /\b(?:muy|super|re|tan|bastante)\s+(?:car[oa]s?|alt[oa]s?|elevad[oa]s?|much[oa]|exager\w+|abusiv\w+|excesiv\w+)\b/.test(
      message
    ) ||
    /\b(?:un abuso|una locura|un robo|un monton|un montonazo)\b/.test(message) ||
    // "que se llevan/quedan TANTO", "por que se llevan tanto": objecion al importe en 3a persona (fuzz revisor).
    /\bse (?:llevan|quedan|lleva|queda)[^.?!]{0,15}\btant[oa]s?\b/.test(message)
  )
    return true;
  return false;
}

// Pregunta del MODELO de pago ("es fijo o porcentaje?", "cobro fijo o comision?", "salario o por venta?"):
// pregunta la ESTRUCTURA, no el NUMERO -> respuesta general SIN la cifra (invariante 3 conservador). Backstop
// determinista de la clasificacion moneyTopic=PAYMENT_MODEL de la IA.
function isPaymentModelQuestion(message: string): boolean {
  return (
    /\b(fijo|salario|sueldo|mensual)\b[^.?!]{0,20}\bo\b[^.?!]{0,25}\b(porcentaje|comision|reparto|variable|por venta|por lo que venda|a comision)\b/.test(
      message
    ) ||
    /\b(porcentaje|comision|reparto|variable|por venta|por lo que venda|a comision)\b[^.?!]{0,20}\bo\b[^.?!]{0,20}\b(fijo|salario fijo|sueldo fijo)\b/.test(
      message
    ) ||
    /\bes (un |una )?(sueldo|salario|pago|cobro) fijo\b/.test(message)
  );
}

function isCommercialEscalation(input: BuildResponsePlanInput): boolean {
  const message = normalize(input.inboundMessage);

  // CAPA 2: la IA marco el mensaje como NEGOCIACION del reparto (campo dedicado moneyTopic, limpio en la probe).
  // Escala SIEMPRE (fail-safe: como mucho sobre-escala hacia Alex, jamas libera la cifra). Cubre las
  // negociaciones que el regex no pilla ("no me pueden dar un poco mas a mi?").
  if (input.understanding.moneyTopic === "NEGOTIATE") return true;

  // La negociacion por fraseo escala SIEMPRE, aunque el intent no sea ASKS_ABOUT_PERCENTAGE (invariante 3).
  if (negotiatesRevenueShare(message)) return true;

  // GUARD DE COMPUESTO (revisor 19-jul): "pregunta la cifra + NEGOCIA/OBJETA en el mismo turno" ("cuanto me
  // toca? me merezco mas", "de cuanto es el split? es una miseria", "cuanto saco? prefiero mitad y mitad"). En
  // vez de perseguir conjugaciones (whack-a-mole), se detecta ESTRUCTURALMENTE: si el mensaje tiene una PISTA de
  // pregunta-de-cifra Y ademas (a) una demanda de MAS/la mitad, o (b) una OBJECION al importe (poco/bajo/caro/
  // injusto/miseria/no me alcanza/mitad y mitad) -> es negociacion -> escala (y veta la cifra). Fail-safe: como
  // mucho sobre-escala hacia Alex, jamas libera la cifra. La clase de objecion es acotada (demasiado / muy poco /
  // injusto / no compensa); la pista de cifra evita que "no puedo mas hoy" o "es lo que mas me interesa" disparen.
  const figureCue =
    /\b(cuanto|de cuanto|cual es|que porcentaje|el split|el reparto|del reparto|la parte de la agencia|os quedais|os llevais|me toca|me queda|me llevo|me lleva|mi parte|mi porcentaje|la comision|division de la plata|como se reparte|el 70|del 70|70\/30|70 30)\b/.test(
      message
    );
  const moreDemand =
    /\bla mitad\b/.test(message) ||
    (/\bmas\b/.test(message) &&
      !/\bmas o menos\b/.test(message) &&
      // "lo que mas / me gusta mas / mas me interesa / cada vez mas" = superlativo/preferencia, no demanda.
      !/\b(lo que mas|me (?:gusta|interesa|atrae|llama|copa|encanta|conviene) mas|mas me (?:gusta|interesa|atrae|llama|copa)|cada vez mas)\b/.test(
        message
      ) &&
      !/\b(cuenta\w*|conta\w*|explica\w*|dime|deci\w*|decir|saber|sepa|aclara\w*|pregunta\w*|habla\w*|contar\w*)\b[^.?!]{0,14}\bmas\b/.test(
        message
      ) &&
      !/\b(algo|alguna cosa|nada|una cosa|cualquier cosa)\s+mas\b/.test(message) &&
      !/\bmas\b[^.?!]{0,12}\b(info|informacion|detalle|adelante|tarde)\b/.test(message));
  const objectionCue =
    /\b(?:es|son|me parece|parece|resulta\w*|lo veo|me queda|me sale|seria)\s+(?:re |muy |demasiado |bastante |medio |un |una )?(?:poc[oa]|baj[oa]s?|injust\w+|miseria|car[oa]s?|much[oa]|abus\w+|excesiv\w+|robo|afano|choreo|porqueria|cagada|chot[oa]|mierda|monton|montonazo)\b/.test(
      message
    ) ||
    /\b(no me (?:alcanza|sirve|conviene|compensa|cierra)|me quedo cort[oa]|(?:me )?espera\w+ (?:mas|algo mejor|otra cosa|mucho mas))\b/.test(
      message
    ) ||
    /\bmitad y mitad\b/.test(message);
  // "quiero/deberia ser MENOS lo que se quedan / ojala (sea) POCO / no sea tanto / parte CHICA / ACHIQUEN su
  // parte": es una CONTRAPROPUESTA a la baja (que la agencia se lleve menos) -> negociacion -> escala, NO suelta
  // la cifra. `negotiatesRevenueShare` solo cubria "menor". Fugas cazadas por el revisor 20-jul: "cuanto se
  // quedan ustedes menos" y "achiquen su parte / parte chica". EXCLUIDOS: "mas o menos / por lo menos / al
  // menos / menos de" (ahi "menos" es aproximacion/idiomatico/tiempo, es una pregunta de cifra LEGITIMA).
  const wantsLess =
    (/\bmenos\b/.test(message) && !/\b(?:mas o menos|por lo menos|al menos|cuando menos|menos de|ni menos)\b/.test(message)) ||
    /\bno (?:sea|vaya a ser)\s+tanto\b/.test(message) ||
    /\bno quiero que sea tanto\b/.test(message) ||
    /\b(?:ojala|espero|espero que|que sea|que fuera|deberia ser|deberian|tendria que ser|tendrian|me gustaria que (?:sea|fuera))\b[^.!?]{0,22}\b(?:poco|poquito|menos|tanto)\b/.test(
      message
    ) ||
    // "que su parte sea CHICA/pequeña" / "ACHIQUEN/recorten/reduzcan su parte": pedir a la baja. Anclado a un
    // termino de reparto para no disparar con "una chica" (persona).
    /\b(?:parte|comision|tajada|porcion)\b[^.!?]{0,12}\b(?:chic[oa]s?|pequen[oa]s?|reducid[oa]s?)\b/.test(message) ||
    /\b(?:chic[oa]s?|pequen[oa]s?)\b[^.!?]{0,12}\b(?:parte|comision|tajada|porcion)\b/.test(message) ||
    /\b(?:achic\w+|achiqu\w+|recort\w+|reduzc\w+|reduc\w+)\b[^.!?]{0,18}\b(?:su parte|la parte|vuestra parte|comision|parte|lo que se (?:llevan|quedan)|su tajada)\b/.test(
      message
    );
  if (figureCue && (moreDemand || objectionCue || wantsLess)) return true;

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
  // Preguntar la CIFRA del reparto, del lado agencia ("os quedais") o del PROPIO ("mi porcentaje",
  // "lo que gano yo", "cual es mi porcentaje"). + "de cuanto seria/es el porcentaje" y "la parte de la
  // agencia" / "de cuanto porcentaje estamos" (barrido 19-jul, Ale: se perdio el lead porque preguntaba la
  // parte de la agencia y no se le daba la cifra).
  const asksExactFigurePattern =
    /\b(cual es el (porcentaje|reparto)|como es el reparto|exacto|70\/30|quien recibe|quien se queda|os quedais|os qued|os llevais|os llev|cuanto os|que os qued|cuanto me llevo|cuanto me qued|cuanto me toca|cuanto saco|que me llevo|que me qued|cual es mi parte|cuanto es mi parte|cuanto gano|cuanto es para mi|me pagan|me pagarian|me pagaria|cuanto dinero me|cuanto cobro|mi porcentaje|porcentaje (para mi|mio)|el que (ganare|gano|gane|voy a ganar) yo|lo que (ganare|gano|voy a ganar|me llevo|me queda|me toca)|que me queda a mi|que me llevo yo|q(ue)? porcentaje|de cuanto (seria|es|va a ser|sera|estamos hablando)( (el|un))? ?(porcentaje|reparto)?|cuanto (seria|es) (el|mi) (porcentaje|reparto)|(cual|cuanto|de cuanto)[^.?!]{0,20}\bla parte (de la agencia|vuestra|suya|que se queda|que os quedais)|la parte de la agencia|porcentaje[^.?!]{0,15}para (mi|ustedes|vosotros)|mi ganancia|su comision|cual es (su|la) comision)\b/;
  // Fraseos que SIEMPRE son una pregunta directa por la CIFRA (nunca aparecen en una frase-afirmacion), asi
  // que disparan el 70/30 AUNQUE el modelo de comprension etiquete mal el intent (barrido 19-jul, Ale: mini
  // la clasifico como algo distinto de ASKS_ABOUT_PERCENTAGE y el gate por intent la dejaba caer en la rama
  // evasiva -> lead perdido). Es un SUBCONJUNTO de alta precision del patron de arriba, no toda su amplitud:
  // el patron general ("me pagan", "cuanto gano") puede colarse en una frase-afirmacion y por eso sigue
  // exigiendo el intent; estos otros no. NO afecta a la pregunta del MODELO de pago ("sueldo fijo o
  // porcentaje?"), que no casa ninguno de estos.
  // Clase semantica "pregunta CUANTO es la parte / el reparto / lo que se lleva cada uno". Se AMPLIO (Capa 2,
  // 19-jul) con los fraseos que el fuzz vio perder el lead ("el split", "cuanto porciento me toca", "que se
  // llevan", "cual seria mi parte", "la division de la plata"...). Es DETERMINISTA (invariante 1: el % lo decide
  // el codigo, no el modelo) y va gateado por looksLikeFigureQuestion; una propuesta con numero ("que se quedan
  // con 60") la VETA isCommercialEscalation (proposesNonStandardSplit), asi que no filtra.
  // Las adiciones de Capa 2 (fraseos que el fuzz perdia) van SOLO en forma de pregunta ANCLADA a un interrogativo
  // (cuanto/cual/de cuanto/como es): un sustantivo suelto ("split", "division", "lo que se llevan") tambien
  // aparece en CONTRAPROPUESTAS ("el split 50 50 se puede?") y OBJECIONES ("es un monton lo que se quedan"), que
  // NO deben soltar la cifra por la via determinista (bloqueante del revisor 19-jul). Los verbos en 1a persona
  // ("cuanto me toca/queda/llevo") no solapan con negociaciones. La negociacion sigue vetando via isCommercialEscalation.
  const asksExactFigureUnambiguous =
    /\b(cual es (el|mi|su|la) (porcentaje|reparto|comision)|cual seria (mi parte|el reparto|mi porcentaje)|de cuanto (seria|es|va a ser|sera|estamos hablando)( (el|un))? ?(porcentaje|reparto)|de cuanto (porcentaje|reparto)|cuanto (seria|es) (el|mi) (porcentaje|reparto)|(el |mi )?porcentaje cuanto (es|sale|seria|queda)|cuanto (me toca|me queda|me llevo|me lleva|agarro|saco|gano yo|cobro yo)|porciento me toca|(?:de cuanto es|cuanto es|como es|como queda|como funciona)( el| del| un)? split|split (?:como es|como queda|de cuanto|como funciona)|(?:de cuanto es|cuanto es|como es|como queda)( la)? division de (?:la plata|el dinero|lo que se gana)|division de (?:la plata|el dinero|lo que se gana) (?:como es|como queda|de cuanto)|cuanto se (?:queda|lleva) la agencia|cuanto se (?:quedan|llevan) (?:ustedes|uds|vosotros)|(cuanto|que porcentaje) os (quedais|qued|llevais|llev)|(cual|cuanto|de cuanto)[^.?!]{0,20}\bla parte (de la agencia|vuestra|suya|que se queda|que os quedais)|la parte de la agencia)\b/;
  // La rama "sin intent" es un detector de SUBCADENA, asi que "la parte de la agencia" tambien casa dentro de
  // una AFIRMACION ("me parece cara la parte de la agencia") o una NEGOCIACION ("quiero que sea menor la parte
  // de la agencia") -> soltaria el 70/30 sin que sea una pregunta y sin escalar (fuga del invariante 3 que cazo
  // el revisor 19-jul). Se gatea a CONTEXTO INTERROGATIVO: hay "?"/"¿" o el mensaje ARRANCA con un interrogativo
  // (de cuanto / cuanto / cual / que porcentaje / como es). Los fraseos de Ale ("de cuanto seria la parte de la
  // agencia?", "de cuanto porcentaje estamos hablando?") lo cumplen; las afirmaciones/negociaciones no.
  const looksLikeFigureQuestion =
    /[?¿]/.test(message) ||
    /^\s*(?:y |ok |okey |vale |pero |oye |che |ah |mmm |a ver )*(?:de\s+cuanto|con\s+cuanto|a\s+cuanto|cuanto|cual|que\s+porcentaje|como\s+es)\b/.test(
      message
    );
  // Deteccion DETERMINISTA de "pide la cifra" (fallback cuando la IA no esta y red de seguridad cuando si).
  const deterministicFigureQuestion =
    (input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" && asksExactFigurePattern.test(message)) ||
    (asksExactFigureUnambiguous.test(message) && looksLikeFigureQuestion);
  // CAPA 2 (19-jul, corregido tras el revisor): INVARIANTE 1 innegociable — el % lo decide CODIGO determinista,
  // JAMAS la salida del modelo. Por eso la CIFRA se dispara SOLO por deteccion determinista (regex); moneyTopic
  // =FIGURE NO libera la cifra (eso seria la IA gateando el %, prohibido: el revisor demostro que fugaba 42/50
  // negociaciones forzando FIGURE). La IA solo puede volver el trato MAS SEGURO (fail-safe), nunca soltar una
  // cifra que el codigo no autorice:
  //  - moneyTopic=NEGOTIATE -> escala (mas supervision humana; via isCommercialEscalation). Caza negociaciones
  //    cuyo fraseo el regex no pilla, SIN riesgo (escalar es conservador).
  //  - moneyTopic=PAYMENT_MODEL -> veta la cifra (mas conservador).
  // moneyTopic=TIMING/NONE no tocan la decision de la cifra. En fallback (NONE) el comportamiento es EXACTO al
  // determinista de siempre. La cobertura de fraseos de la CIFRA se gana ampliando el regex determinista, no la IA.
  const figureRequested = deterministicFigureQuestion;
  const isPaymentModel = input.understanding.moneyTopic === "PAYMENT_MODEL" || isPaymentModelQuestion(message);
  const exactPercentageQuestion = figureRequested && !isCommercialEscalation(input) && !isPaymentModel;
  const generalCommercialQuestion =
    input.understanding.intent === "ASKS_ABOUT_PERCENTAGE" ||
    input.understanding.moneyTopic !== "NONE" ||
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
