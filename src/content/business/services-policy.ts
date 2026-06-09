import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "services-agency-management",
    category: "SERVICES",
    title: "Servicios principales de la agencia",
    facts: ["La agencia se encarga de estrategia, trafico, monetizacion, chatting y gestion acordada."],
    approvedAnswerPoints: ["Nosotros llevamos la parte de estrategia, trafico, monetizacion, chatting y gestion acordada.", "La idea es que la modelo no tenga que llevar sola toda la parte de crecimiento y gestion."],
    prohibitedClaims: ["Prometer resultados concretos.", "Afirmar servicios no documentados como fotografia, viajes o contratos externos."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["services", "agency", "strategy", "traffic", "monetization"],
    mandatoryNuances: ["No prometer resultados.", "No inventar servicios concretos no documentados."],
    escalationConditions: ["La candidata pide resultados garantizados.", "La candidata pregunta por servicios no documentados."],
    requiresHumanReview: false,
    version: "services-agency-management-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const servicesPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
