import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

// Plazo confirmado por Alex el 2026-06-11: unos 30 dias desde la creacion de la cuenta,
// a veces un poco antes si la cuenta crece muy rapido. (La mencion a "2-3 semanas" vista en
// algun chat antiguo queda descartada como afirmacion.)
const entries: KnowledgeEntryInput[] = [
  {
    id: "launch-timeline",
    category: "SERVICES",
    title: "Plazo de lanzamiento de OnlyFans",
    facts: [
      "El lanzamiento llega aproximadamente a los 30 dias desde que se crea la cuenta de Instagram.",
      "Puede adelantarse un poco si la cuenta crece muy rapido.",
      "Los primeros dias (unos 5) son de calentamiento de la cuenta."
    ],
    approvedAnswerPoints: [
      "El lanzamiento suele ser a los 30 dias desde que creamos la cuenta, a veces un poco antes si la cuenta crece muy rapido.",
      "Los primeros dias son de calentamiento de la cuenta y despues empezamos a publicar con mas volumen."
    ],
    prohibitedClaims: [
      "Prometer una fecha exacta de lanzamiento o de primeros ingresos.",
      "Afirmar que el lanzamiento es a las 2 o 3 semanas.",
      "Garantizar que el plazo se adelantara."
    ],
    mandatoryNuances: ["El plazo es orientativo y depende del crecimiento de la cuenta."],
    escalationConditions: ["La candidata exige compromisos de fechas o de ingresos por escrito."],
    allowedStates: [
      "NEW_LEAD",
      "QUALIFYING",
      "APPROVED",
      "COLLECTING_CALL_DETAILS",
      "READY_TO_SCHEDULE",
      "HUMAN_INTERVENTION_REQUIRED"
    ],
    tags: ["launch", "timeline", "warmup"],
    requiresHumanReview: false,
    version: "launch-timeline-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const launchTimelineEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
