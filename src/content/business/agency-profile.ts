import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "agency-profile-rose-models",
    category: "AGENCY_PROFILE",
    title: "Rose Models como agencia espanola",
    facts: ["Rose Models es una agencia espanola representada en el chat por Alex."],
    approvedAnswerPoints: ["Soy Alex, de Rose Models.", "Somos una agencia espanola."],
    prohibitedClaims: [
      "Decir que es una gran empresa internacional si no esta confirmado.",
      "Inventar sedes, clientes o casos de exito."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["agency", "identity", "rose-models"],
    requiresHumanReview: false,
    version: "agency-profile-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const agencyProfileEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
