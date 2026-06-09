import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "content-model-responsibilities",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Responsabilidades principales de la modelo",
    facts: ["Responsabilidades concretas de agencia y modelo pendientes de confirmacion final por Alex."],
    approvedAnswerPoints: ["Esa parte la vemos mejor en llamada, porque depende de lo que acordemos y quiero explicartelo bien."],
    prohibitedClaims: ["Solicitar contenido intimo por chat inicial.", "Exigir documentos sensibles en esta fase.", "Imponer un calendario no confirmado."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["model-responsibilities", "content", "availability"],
    mandatoryNuances: ["No afirmar todavia que la modelo solo envia contenido.", "No cerrar responsabilidades operativas hasta confirmacion humana."],
    escalationConditions: ["La candidata pide detalle operativo exacto.", "La candidata pregunta obligaciones concretas."],
    requiresHumanReview: true,
    version: "content-model-responsibilities-2026-06-08.1",
    status: "DRAFT",
    approvedByAlex: false,
    updatedAt: "2026-06-08"
  }
];

export const contentResponsibilityEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
