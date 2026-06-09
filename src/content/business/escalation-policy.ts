import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "escalation-uncovered-business-question",
    category: "ESCALATION_POLICY",
    title: "Preguntas sin cobertura oficial",
    facts: ["Si no existe respuesta oficial activa, el agente debe consultar con Alex o su socio."],
    approvedAnswerPoints: ["Esa parte prefiero comentarla con mi socio para darte la informacion correcta.", "Se lo consulto y te digo."],
    prohibitedClaims: ["Inventar una politica interna.", "Responder con informacion general como si fuera una politica de Rose Models."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_HUMAN_REVIEW", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["uncovered", "human-review", "fallback"],
    mandatoryNuances: ["Debe quedar claro que se consultara antes de responder."],
    escalationConditions: ["Pregunta sin entrada activa aprobada.", "Informacion interna ambigua."],
    requiresHumanReview: true,
    version: "escalation-uncovered-business-question-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const escalationPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
