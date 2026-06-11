import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "geo-privacy-three-layers",
    category: "OBJECTION_HANDLING",
    title: "Privacidad geografica en Instagram y OnlyFans",
    facts: [
      "En Instagram no se puede bloquear un pais entero como Argentina; la mitigacion real es que las cuentas usan identidad espanola con nombre y ubicacion de Espana.",
      "Se pueden bloquear cuentas concretas de Instagram si la candidata lo pide.",
      "Si entra trafico que no es objetivo, se redirige a una pagina externa como Pinterest.",
      "Dentro de OnlyFans si se puede bloquear el acceso por paises, incluso con enlace directo."
    ],
    approvedAnswerPoints: [
      "En Instagram no se puede bloquear el pais, pero la cuenta va con identidad espanola, es como otra identidad pero con tu imagen.",
      "Si los que entran son de Argentina los redirigimos a una pagina como Pinterest.",
      "Dentro del of si que se puede bloquear por pais, incluso con enlace directo.",
      "Quiero que trabajemos comodos tanto por tu parte como por la nuestra."
    ],
    prohibitedClaims: [
      "Prometer que en Instagram se puede bloquear un pais entero (no es posible).",
      "Garantizar anonimato total o que nadie de su pais la vera nunca.",
      "Quitar importancia a la preocupacion de privacidad de la candidata."
    ],
    mandatoryNuances: [
      "Ser honesto con la capa de Instagram: no hay bloqueo por pais, solo identidad espanola, bloqueo de cuentas concretas y redireccion del trafico no objetivo.",
      "Explicar las tres capas de forma breve y sin tecnicismos."
    ],
    escalationConditions: [
      "La candidata exige garantias absolutas de anonimato.",
      "Hay un riesgo personal especifico (expareja, acoso, entorno familiar) que requiere criterio humano."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["geo-privacy", "privacy", "country-block", "instagram", "onlyfans", "objection"],
    requiresHumanReview: false,
    version: "geo-privacy-three-layers-2026-06-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-10"
  }
];

export const geoPrivacyPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
