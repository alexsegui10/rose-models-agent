import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "faq-how-it-works-covered",
    category: "FAQ",
    title: "Como funciona a nivel general",
    facts: [
      "Rose Models valora primero el perfil, recopila informacion basica y despues puede organizar una llamada para explicar los detalles."
    ],
    approvedAnswerPoints: [
      "Primero valoramos un poco el perfil.",
      "Si vemos que encaja, organizamos una llamada y lo explicamos con calma."
    ],
    prohibitedClaims: ["Aceptar automaticamente.", "Prometer resultados o ingresos."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["faq", "process", "how-it-works"],
    requiresHumanReview: false,
    version: "faq-how-it-works-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  }
];

export const frequentlyAskedQuestionEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
