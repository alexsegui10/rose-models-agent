import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "objection-distrust",
    category: "OBJECTION_HANDLING",
    title: "Desconfianza inicial",
    facts: [
      "Si la candidata muestra desconfianza, el agente debe responder con calma y no presionar.",
      "El argumento real de confianza es el flujo de pagos: la modelo recibe directamente el dinero de la plataforma y despues paga a Rose Models (coincide con la politica de liquidacion)."
    ],
    approvedAnswerPoints: [
      "Lo entiendo, es normal querer mirarlo con calma.",
      // Respuesta real de Alex a la objecion de estafa/desconfianza (analisis 2026-06-10, r6).
      "Nosotros somos totalmente transparentes.",
      "Eres tu la que recibes los pagos de la plataforma y despues nos pagas a nosotros, asi que el dinero pasa primero por ti.",
      "Podemos ir paso a paso y sin compromiso."
    ],
    prohibitedClaims: ["Presionar.", "Usar promesas para convencer.", "Garantizar ingresos."],
    // La desconfianza escala a HUMAN_INTERVENTION_REQUIRED: justo ahi esta respuesta documentada
    // tiene que seguir disponible (la pausa frena decisiones, no la transparencia).
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_PROFILE_ACCESS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["distrust", "objection", "calm", "scam"],
    requiresHumanReview: false,
    version: "objection-distrust-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const objectionHandlingEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
