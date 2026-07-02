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
      "El canal previsto para llamada es WhatsApp.",
      "La llamada dura aproximadamente entre 2 y 10 minutos.",
      "La llamada sirve para presentarse, recordar lo hablado, explicar como trabaja Rose Models, resolver dudas, tratar porcentaje si corresponde e intentar cerrar.",
      "Alex enviara el contrato por WhatsApp para que la candidata lo lea tranquilamente.",
      "No se recoge documentacion durante la llamada.",
      "No se automatiza todavia el envio del contrato."
    ],
    // CTA de agenda directa (analisis iteracion 3, taxonomia 6): el Alex real agenda sin coletillas
    // de cobertura ("si vemos que encaja", "2 a 10 minutos"); propone cerrar dia y hora ya mismo.
    approvedAnswerPoints: ["La llamada es rapida: te llamamos por telefono al numero que nos pases.", "Si me dices un dia y una hora la agendamos."],
    prohibitedClaims: [
      "Prometer llamada inmediata.",
      "Recoger documentacion durante la llamada.",
      "Automatizar envio de contrato."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_HUMAN_REVIEW", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["call", "schedule", "whatsapp", "review"],
    mandatoryNuances: ["No confirmar llamada cerrada antes de aprobacion o disponibilidad."],
    escalationConditions: ["La candidata exige llamada inmediata.", "La candidata plantea asunto sensible para llamada urgente."],
    requiresHumanReview: false,
    version: "call-details-after-review-2026-06-13.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-13"
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
