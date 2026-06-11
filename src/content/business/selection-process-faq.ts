import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

// Gaps reales del guion que mataron leads: "cual es el proceso de seleccion?" y "a que paises
// venden?" quedaron sin respuesta en chats reales. Propuestas redactadas para que Alex las
// apruebe; mientras tanto quedan en DRAFT y la pregunta se escala a revision humana.
const entries: KnowledgeEntryInput[] = [
  {
    id: "faq-selection-process-draft",
    category: "FAQ",
    title: "Proceso de seleccion (propuesta pendiente de Alex)",
    facts: [
      "La pregunta 'cual es el proceso de seleccion?' quedo sin respuesta en varias conversaciones reales y perdio leads.",
      "Propuesta pendiente de aprobar: revision del perfil, preguntas rapidas (nombre, edad, OnlyFans, otras agencias, movil) y llamada final."
    ],
    approvedAnswerPoints: [
      "Propuesta pendiente de Alex: es sencillo, primero vemos tu perfil, te hacemos unas preguntas rapidas y si encajas agendamos una llamada para explicarte todo."
    ],
    prohibitedClaims: ["Prometer aceptacion automatica.", "Detallar criterios fisicos de seleccion."],
    mandatoryNuances: ["Mientras este en DRAFT, la pregunta se deriva a revision humana."],
    escalationConditions: ["Cualquier pregunta por el proceso de seleccion mientras no haya respuesta aprobada."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING"],
    tags: ["faq", "process", "selection"],
    requiresHumanReview: true,
    version: "faq-selection-process-2026-06-10.1",
    status: "DRAFT",
    approvedByAlex: false,
    updatedAt: "2026-06-10"
  },
  {
    id: "faq-target-countries-draft",
    category: "FAQ",
    title: "A que paises se vende (propuesta pendiente de Alex)",
    facts: [
      "La pregunta 'a que paises venden?' no tiene respuesta canonica confirmada por Alex.",
      "Lo dicho en chats reales: el trafico es espanol porque hay mas poder adquisitivo, y en OnlyFans puede bloquearse el acceso por pais."
    ],
    approvedAnswerPoints: [
      "Propuesta pendiente de Alex: trabajamos sobre todo trafico espanol, que es donde hay mas poder adquisitivo."
    ],
    prohibitedClaims: [
      "Decir 'solo trabajamos con espanolas': formulacion discriminatoria e incorrecta, el espanol es el trafico, no la candidata.",
      "Inventar una lista cerrada de paises."
    ],
    mandatoryNuances: ["Mientras este en DRAFT, la pregunta se deriva a revision humana."],
    escalationConditions: ["Cualquier pregunta sobre paises o mercados de venta mientras no haya respuesta aprobada."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED"],
    tags: ["faq", "countries", "market"],
    requiresHumanReview: true,
    version: "faq-target-countries-2026-06-10.1",
    status: "DRAFT",
    approvedByAlex: false,
    updatedAt: "2026-06-10"
  }
];

export const selectionProcessFaqEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
