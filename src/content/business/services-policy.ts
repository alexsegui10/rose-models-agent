import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "services-agency-management",
    category: "SERVICES",
    title: "Servicios principales de la agencia",
    facts: [
      "La agencia se encarga de estrategia, trafico, monetizacion, chatting y gestion acordada.",
      "La modelo solo manda el contenido; la agencia hace el trafico via Instagram y la monetizacion en OnlyFans con un equipo de chatters 24/7."
    ],
    approvedAnswerPoints: [
      // Pitch breve real de Alex (analisis 2026-06-10, plantilla verbatim de 7 hilos, normalizada).
      "Te explico como trabajamos de forma breve: basicamente mandas el contenido y nosotros ya hacemos todo el trafico con Instagram y la monetizacion en OnlyFans con nuestro equipo de chatters 24/7.",
      "En la llamada te lo explicamos todo mejor.",
      "La idea es que la modelo no tenga que llevar sola toda la parte de crecimiento y gestion."
    ],
    prohibitedClaims: [
      "Prometer resultados concretos.",
      "Afirmar servicios no documentados como fotografia, viajes o contratos externos."
    ],
    // Respondible tambien en HUMAN_INTERVENTION_REQUIRED: el pitch operativo nunca debe derivarse
    // al socio (pregunta documentada que mas leads mataba en la evaluacion).
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["services", "agency", "strategy", "traffic", "monetization"],
    mandatoryNuances: ["No prometer resultados.", "No inventar servicios concretos no documentados."],
    escalationConditions: ["La candidata pide resultados garantizados.", "La candidata pregunta por servicios no documentados."],
    requiresHumanReview: false,
    version: "services-agency-management-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const servicesPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
