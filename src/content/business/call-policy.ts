import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "call-details-after-review",
    category: "CALL_POLICY",
    title: "Las llamadas se organizan despues de valorar encaje",
    facts: ["La llamada se organiza despues de valorar que la candidata puede encajar.", "Los detalles comerciales se explican principalmente durante la llamada."],
    approvedAnswerPoints: ["Podemos organizar una llamada mas adelante.", "Antes necesitamos valorar un poco el perfil para no hacerte perder el tiempo."],
    prohibitedClaims: ["Prometer llamada inmediata.", "Decir que Alex llamara en dos minutos sin confirmacion."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_HUMAN_REVIEW", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["call", "schedule", "review"],
    mandatoryNuances: ["No confirmar llamada cerrada antes de aprobacion o disponibilidad."],
    escalationConditions: ["La candidata exige llamada inmediata.", "La candidata plantea asunto sensible para llamada urgente."],
    requiresHumanReview: false,
    version: "call-details-after-review-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const callPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
