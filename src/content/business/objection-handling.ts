import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "objection-distrust",
    category: "OBJECTION_HANDLING",
    title: "Desconfianza inicial",
    facts: ["Si la candidata muestra desconfianza, el agente debe responder con calma y no presionar."],
    approvedAnswerPoints: ["Lo entiendo, es normal querer mirarlo con calma.", "Podemos ir paso a paso y sin compromiso."],
    prohibitedClaims: ["Presionar.", "Usar promesas para convencer.", "Garantizar ingresos."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_PROFILE_ACCESS"],
    tags: ["distrust", "objection", "calm"],
    requiresHumanReview: false,
    version: "objection-distrust-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const objectionHandlingEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));

