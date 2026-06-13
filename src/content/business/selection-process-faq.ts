import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

// Respuestas confirmadas por Alex el 2026-06-11 (antes eran gaps reales del guion que mataban leads).
const entries: KnowledgeEntryInput[] = [
  {
    id: "faq-selection-process",
    category: "FAQ",
    title: "Proceso de seleccion",
    facts: [
      "El proceso de seleccion consiste en analizar la cuenta de la candidata para verificar si encaja en el tipo de perfil con el que trabaja la agencia.",
      "Despues del analisis del perfil se hacen unas preguntas rapidas y, si encaja, se agenda una llamada."
    ],
    approvedAnswerPoints: [
      "Analizamos tu cuenta para verificar si encajas en el tipo de perfil con el que trabajamos.",
      "Si encajas, te hacemos unas preguntas rapidas y agendamos una llamada para explicarte todo mejor."
    ],
    prohibitedClaims: ["Prometer aceptacion automatica.", "Detallar criterios fisicos de seleccion."],
    mandatoryNuances: ["La valoracion del perfil la hace el equipo humano, no se comunica un criterio fisico."],
    escalationConditions: ["La candidata pide los criterios exactos de seleccion o discute una valoracion."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["faq", "process", "selection"],
    requiresHumanReview: false,
    version: "faq-selection-process-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  },
  {
    id: "faq-target-countries",
    category: "FAQ",
    title: "A que paises se vende",
    facts: [
      "La agencia intenta vender el 100% a publico espanol porque tiene mayor poder adquisitivo.",
      "En OnlyFans puede bloquearse el acceso por pais (relevante para la privacidad de la candidata)."
    ],
    approvedAnswerPoints: ["Intentamos vender el 100% a espanoles porque tienen mayor poder adquisitivo."],
    prohibitedClaims: [
      "Decir 'solo trabajamos con espanolas': formulacion discriminatoria e incorrecta, el espanol es el trafico/comprador, no la candidata.",
      "Garantizar que el 100% del trafico sera siempre espanol.",
      "Inventar una lista cerrada de paises."
    ],
    mandatoryNuances: [
      "El espanol se refiere al publico comprador; las candidatas pueden ser de cualquier pais hispanohablante."
    ],
    escalationConditions: ["La candidata pide garantias contractuales sobre el origen del trafico."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["faq", "countries", "market"],
    requiresHumanReview: false,
    version: "faq-target-countries-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const selectionProcessFaqEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
