import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

export const postCallSummaryRequiredFields = [
  "name",
  "declaredAge",
  "country",
  "instagram",
  "phone",
  "experience",
  "activeOnlyFans",
  "otherAgency",
  "device",
  "availability",
  "contentProductionCapacity",
  "existingMaterial",
  "boundaries",
  "initialPercentage",
  "negotiation",
  "finalPercentage",
  "objections",
  "interestLevel",
  "specialConditions",
  "pendingQuestions",
  "recommendation",
  "nextAction",
  "recordingUrl",
  "transcript"
] as const;

const entries: KnowledgeEntryInput[] = [
  {
    id: "call-details-after-review",
    category: "CALL_POLICY",
    title: "Llamada telefonica despues de valorar encaje",
    facts: [
      "La llamada es una llamada de telefono normal al numero que de la candidata.",
      "La llamada dura aproximadamente entre 2 y 10 minutos.",
      "La llamada sirve para presentarse, recordar lo hablado, explicar como trabaja Rose Models, resolver dudas, tratar porcentaje si corresponde e intentar cerrar.",
      "Alex enviara el contrato por WhatsApp para que la candidata lo lea tranquilamente.",
      "No se recoge documentacion durante la llamada.",
      "No se automatiza todavia el envio del contrato."
    ],
    // CTA de agenda directa (analisis iteracion 3, taxonomia 6): el Alex real agenda sin coletillas
    // de cobertura ("si vemos que encaja", "2 a 10 minutos"); propone cerrar dia y hora ya mismo.
    approvedAnswerPoints: [
      "La llamada es rapida: te llamamos por telefono al numero que nos pases.",
      "Si me dices un dia y una hora la agendamos."
    ],
    // 17-jul (Alex): antes ponia "Prometer llamada inmediata", y era una contradiccion: esta ficha SOLO se
    // sirve tras el Encaja (ver allowedStates abajo) y ahi prometer la llamada es justo lo que Alex quiere
    // ("Te llamo en un rato entonces"). Lo prohibido de verdad es comprometerla ANTES de la aprobacion
    // (invariante 4) — lo que ya vigila de forma determinista el validador factual.
    // El fraseo va en la ficcion del bot (el bot ES Alex y al decisor lo llama "mi socio", nunca "Alex" en
    // 3a persona) y nombra el dato observable del prompt (humanFitDecision), no jerga interna del CRM.
    prohibitedClaims: [
      "Prometer o dar por agendada la llamada sin el visto bueno del socio (humanFitDecision APPROVED).",
      "Recoger documentacion durante la llamada.",
      "Automatizar envio de contrato."
    ],
    // SOLO tras el Encaja de Alex (caso real Yesica 5-jul): con NEW_LEAD/QUALIFYING/WAITING permitidos,
    // el redactor recibia "si me dices un dia y una hora la agendamos" ANTES de la aprobacion y proponia
    // la llamada por texto sin el OK ("te la dejo apuntada") — Alex tuvo que frenarla a mano desde el CRM.
    // La propuesta de llamada la abre SIEMPRE la decision humana (invariante 4), nunca el conocimiento.
    allowedStates: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE"],
    tags: ["call", "schedule", "whatsapp", "review"],
    mandatoryNuances: ["No confirmar llamada cerrada antes de aprobacion o disponibilidad."],
    escalationConditions: ["La candidata exige llamada inmediata.", "La candidata plantea asunto sensible para llamada urgente."],
    requiresHumanReview: false,
    version: "call-details-after-review-2026-07-17.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-17"
  },
  {
    // Formato NEUTRAL de la llamada, respondible YA en la cualificacion (decision de Alex 20-jul: "es telefono").
    // Contesta el DATO factual ("es telefono, cortita, para conocernos") cuando preguntan "es video o telefono? /
    // cuanto dura? / de que me hablan?", pero SIN proponer agenda ni pedir el numero — eso lo abre siempre la
    // aprobacion humana post-Encaja (invariante 4) y lo sirve call-details-after-review, que sigue gateado.
    // allowedStates SOLO pre-Encaja: en post-Encaja gana call-details-after-review (con su CTA de agendar).
    id: "call-format-neutral",
    category: "CALL_POLICY",
    title: "Formato de la llamada (neutral, sin agendar)",
    facts: [
      "La llamada es una llamada de telefono normal.",
      "Es corta, de unos minutos.",
      "Sirve para conocernos, explicar bien como trabaja Rose Models y resolver dudas."
    ],
    approvedAnswerPoints: [
      "Es una llamada de telefono normal, cortita, de unos minutos, para conocernos y que te explique bien como trabajamos y resuelvas tus dudas."
    ],
    prohibitedClaims: [
      "Proponer o dar por agendada la llamada antes de la aprobacion.",
      "Pedir el numero de telefono antes de la aprobacion.",
      "Prometer una llamada inmediata.",
      "Mencionar videollamada (la agencia no hace videollamadas)."
    ],
    mandatoryNuances: ["No proponer agenda ni pedir el numero: eso es despues del Encaja."],
    escalationConditions: [],
    // SOLO pre-review (NEW_LEAD/QUALIFYING): en revision/HIR una peticion de llamada DIFIERE al socio (regla
    // Alex 20-jun), no se responde el formato; y post-Encaja gana call-details-after-review (con CTA de agenda).
    // Surge SOLO por el tag dedicado "call-format" (detector estrecho de PREGUNTA de formato), no por "call".
    allowedStates: ["NEW_LEAD", "QUALIFYING"],
    tags: ["call-format"],
    requiresHumanReview: false,
    version: "call-format-neutral-2026-07-20.2",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-20"
  },
  {
    id: "call-recording-retell-policy",
    category: "CALL_POLICY",
    title: "Grabacion y transcripcion de llamadas",
    facts: [
      "Retell debe informar al principio de que la llamada sera grabada y transcrita, explicar finalidad y solicitar aceptacion.",
      "Si no acepta, se finaliza educadamente la llamada.",
      "Debe registrarse fecha, hora, aceptacion, grabacion y transcripcion."
    ],
    approvedAnswerPoints: ["Al inicio de la llamada se avisaria de la grabacion y transcripcion y se pediria aceptacion."],
    prohibitedClaims: ["Grabar sin avisar.", "Continuar si rechaza la grabacion.", "Implementar Retell en esta fase."],
    mandatoryNuances: ["Politica preparada, Retell no implementado todavia."],
    escalationConditions: ["Rechaza grabacion.", "Dudas legales sobre grabacion."],
    allowedStates: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "CALL_SCHEDULED"],
    tags: ["retell", "recording", "transcript", "consent"],
    requiresHumanReview: false,
    version: "call-recording-retell-policy-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "call-post-summary",
    category: "CALL_POLICY",
    title: "Resumen posterior a la llamada",
    facts: postCallSummaryRequiredFields.map((field) => `El resumen posterior debe incluir ${field}.`),
    approvedAnswerPoints: ["Despues de la llamada, el resumen queda para Alex y el proceso pasa a revision manual."],
    prohibitedClaims: [
      "Dejar al chatbot completar incorporacion despues de llamada.",
      "Omitir grabacion o transcripcion cuando existan."
    ],
    mandatoryNuances: ["Despues de la llamada el chatbot deja el proceso en manos de Alex."],
    escalationConditions: ["Faltan campos criticos del resumen."],
    allowedStates: ["CALL_SCHEDULED", "READY_TO_SCHEDULE", "APPROVED"],
    tags: ["post-call-summary", "handoff", "alex"],
    requiresHumanReview: false,
    version: "call-post-summary-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const callPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
