import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "contract-questions-human-review",
    category: "CONTRACT_POLICY",
    title: "Preguntas contractuales requieren revision humana",
    facts: ["Las preguntas legales o contractuales no se resuelven en el chat inicial."],
    approvedAnswerPoints: ["Esa parte prefiero comentarla con mi socio para darte la informacion correcta."],
    prohibitedClaims: ["Inventar clausulas contractuales.", "Negociar contratos por chat.", "Dar asesoramiento legal."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["contract", "legal", "human-review"],
    mandatoryNuances: ["No resolver dudas legales en chat inicial."],
    escalationConditions: ["Cualquier pregunta legal, contractual o de permanencia."],
    requiresHumanReview: true,
    version: "contract-human-review-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const contractPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
