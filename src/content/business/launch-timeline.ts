import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

// Contradiccion real entre conversaciones (2-3 semanas vs 30 dias). Pendiente de que Alex
// confirme el plazo vigente: hasta entonces la entrada queda en DRAFT y no se usa para responder.
const entries: KnowledgeEntryInput[] = [
  {
    id: "launch-timeline-pending",
    category: "SERVICES",
    title: "Plazo de lanzamiento pendiente de confirmacion de Alex",
    facts: [
      "En conversaciones reales el lanzamiento de OnlyFans se explico de dos formas contradictorias: a las 2 o 3 semanas en unos hilos y a los 30 dias en otros.",
      "El calentamiento inicial de unos 5 dias si esta confirmado.",
      "Alex debe confirmar el plazo de lanzamiento vigente antes de activar esta entrada."
    ],
    approvedAnswerPoints: [
      "Propuesta pendiente de Alex: los primeros dias son de calentamiento y el plazo exacto del lanzamiento te lo confirma Alex en la llamada."
    ],
    prohibitedClaims: [
      "Afirmar que el lanzamiento es a las 2 o 3 semanas.",
      "Afirmar que el lanzamiento es a los 30 dias.",
      "Prometer fechas de resultados o de facturacion."
    ],
    mandatoryNuances: [
      "Mientras Alex no confirme el plazo, no afirmar ninguna de las dos cifras y derivar el detalle a la llamada."
    ],
    escalationConditions: ["Pregunta por el plazo exacto de lanzamiento o de primeros resultados."],
    allowedStates: ["QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["launch", "timeline", "warmup", "pending-alex"],
    requiresHumanReview: true,
    version: "launch-timeline-pending-2026-06-10.1",
    status: "DRAFT",
    approvedByAlex: false,
    updatedAt: "2026-06-10"
  }
];

export const launchTimelineEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
