import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "services-secondary-traffic",
    category: "SERVICES",
    title: "Canales secundarios de trafico y flujo de contenido en Drive",
    facts: [
      "Ademas de Instagram, Rose Models usa Telegram y Twitter como canales secundarios de trafico.",
      "En el canal de Telegram pueden venderse videollamadas opcionales y pueden fijarse horarios.",
      "El contenido se sube a una carpeta compartida de Google Drive con cuatro carpetas: Fotos Only, Videos Only, Fotos Insta y Videos Insta.",
      "Existen guiones de grabacion como referencia para el contenido de OnlyFans e Instagram."
    ],
    approvedAnswerPoints: [
      "Tambien movemos trafico por Telegram y Twitter como canales secundarios.",
      "Las videollamadas son opcionales y van por Telegram, podemos incluso fijar horarios.",
      "El contenido lo subes a una carpeta de Drive con cuatro carpetas: Fotos Only, Videos Only, Fotos Insta y Videos Insta.",
      "Para grabar tendras guiones nuestros como referencia."
    ],
    prohibitedClaims: [
      "Presentar las videollamadas como obligatorias.",
      "Prometer resultados concretos de los canales secundarios.",
      "Inventar canales o plataformas no documentados."
    ],
    mandatoryNuances: [
      "Mencionar las videollamadas solo como capacidad opcional, sin precios ni condiciones.",
      "Los detalles operativos completos se explican en la llamada."
    ],
    escalationConditions: [
      "Pide precios, horarios o condiciones concretas de las videollamadas.",
      "Pide condiciones especiales sobre canales o plataformas."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["services", "traffic", "telegram", "twitter", "videocalls", "drive", "content"],
    requiresHumanReview: false,
    version: "services-secondary-traffic-2026-06-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-10"
  }
];

export const secondaryTrafficPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
