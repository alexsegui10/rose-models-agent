import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "services-agency-management",
    category: "SERVICES",
    title: "Servicios principales de la agencia",
    facts: [
      "La agencia se encarga de estrategia, trafico, monetizacion, chatting y gestion acordada.",
      "La modelo solo manda el contenido; la agencia hace el trafico creando cuentas de Instagram con ubicaciones y nombres españoles, y al llegar a bastantes seguidores pone el link al OnlyFans y monetiza con un equipo de chatters 24/7."
    ],
    approvedAnswerPoints: [
      // Pitch confirmado por Alex (14-jun): mecanismo real (cuentas de Instagram españolas -> seguidores
      // -> link al OF -> monetizacion con chatters). Se entrega tambien PROACTIVAMENTE cuando la
      // candidata NO ha trabajado con agencias (no sabe en que consiste lo de la agencia), no solo si
      // pregunta "como trabajais".
      "Te explico rapido como trabajamos: tu solo te encargas de mandar el contenido y nosotros hacemos el resto, la monetizacion, el trafico y toda la gestion.",
      "El trafico lo hacemos con cuentas de instagram que creamos con ubicaciones y nombres españoles, y cuando ya tienen bastantes seguidores ponemos el link a tu of y empezamos a monetizar con el equipo de chatters 24/7.",
      "En la llamada te lo explico todo mejor."
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
    version: "services-agency-management-2026-06-14.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-14"
  }
];

export const servicesPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
