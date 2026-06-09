import { KnowledgeEntrySchema, RevenueSharePolicySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

export const activeRevenueSharePolicy = RevenueSharePolicySchema.parse({
  agencyPercentage: null,
  modelPercentage: null,
  isConfirmed: false,
  discloseOnlyWhenExplicitlyAsked: true,
  canExplainNoFixedSalaryInChat: true,
  canDiscloseExactPercentagesInChat: false,
  canNegotiateByChat: false,
  negotiationRequiresHumanReview: true,
  approvedGeneralExplanation: "No funciona como un salario fijo. Va por reparto y los detalles concretos se explican mejor en llamada.",
  approvedPercentageExplanation: null,
  minimumAgencyPercentage: null,
  maximumModelPercentage: null,
  version: "commercial-revenue-share-2026-06-08.1"
});

const entries: KnowledgeEntryInput[] = [
  {
    id: "commercial-no-fixed-salary",
    category: "COMMERCIAL",
    title: "Rose Models no trabaja con salario fijo",
    facts: ["Rose Models no trabaja mediante salario fijo.", "El modelo comercial se explica con detalle durante la llamada."],
    approvedAnswerPoints: ["No funciona como un salario fijo.", "Va por reparto.", "Los detalles se explican mejor en llamada para que quede claro."],
    prohibitedClaims: ["Prometer un sueldo mensual.", "Prometer ingresos garantizados.", "Dar cifras de ganancias."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["salary", "commercial", "payment"],
    requiresHumanReview: false,
    version: "commercial-no-fixed-salary-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  },
  {
    id: "commercial-revenue-share-general",
    category: "COMMERCIAL",
    title: "Modelo general de reparto porcentual",
    facts: [
      "Rose Models trabaja mediante reparto porcentual.",
      "No existe salario fijo.",
      "El porcentaje no se menciona de forma proactiva.",
      "Los detalles comerciales se explican principalmente durante la llamada.",
      "El agente no puede negociar porcentajes por chat."
    ],
    approvedAnswerPoints: ["Va por reparto, no por salario fijo.", "Los detalles concretos se explican mejor en llamada para que quede todo claro."],
    prohibitedClaims: ["Decir que la modelo recibe el 70%.", "Decir que la agencia recibe el 70%.", "Negociar un porcentaje por chat.", "Ofrecer porcentajes distintos."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["percentage", "revenue-share"],
    mandatoryNuances: ["No explicar quien recibe cada porcentaje hasta que este confirmado.", "No negociar por chat."],
    escalationConditions: ["La candidata pide excepciones.", "La candidata negocia un porcentaje.", "La candidata pregunta quien recibe cada parte del 70/30."],
    requiresHumanReview: false,
    version: "commercial-revenue-share-general-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  },
  {
    id: "commercial-revenue-share-split-unconfirmed",
    category: "COMMERCIAL",
    title: "Reparto 70/30 no confirmado",
    facts: ["Se ha mencionado un reparto habitual 70/30, pero no esta confirmado quien recibe cada parte."],
    approvedAnswerPoints: ["Esa parte prefiero revisarla con mi socio antes de confirmarla por aqui."],
    prohibitedClaims: ["Decir que la modelo recibe el 70%.", "Decir que la agencia recibe el 70%."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["percentage-split", "revenue-share", "sensitive"],
    mandatoryNuances: ["No inventar el sentido del reparto 70/30."],
    escalationConditions: ["Pregunta quien recibe cada porcentaje.", "Pide confirmar 70/30 por chat."],
    requiresHumanReview: true,
    version: "commercial-revenue-share-split-unconfirmed-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
];

export const commercialPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
