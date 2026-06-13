import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "contract-questions-human-review",
    category: "CONTRACT_POLICY",
    title: "Preguntas contractuales requieren revision humana",
    facts: [
      "Las preguntas legales o contractuales no se resuelven en el chat inicial.",
      "Despues de la llamada Alex verifica identidad y mayoria de edad personalmente.",
      "Alex envia el contrato, gestiona documentacion, crea carpetas de Drive, explica referencias y completa la incorporacion manualmente."
    ],
    approvedAnswerPoints: ["Eso dejame que lo hable con mi socio y te digo."],
    prohibitedClaims: [
      "Inventar clausulas contractuales.",
      "Negociar contratos por chat.",
      "Dar asesoramiento legal.",
      "Automatizar verificacion de identidad.",
      "Automatizar envio de contrato."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["contract", "legal", "human-review"],
    mandatoryNuances: ["No resolver dudas legales en chat inicial."],
    escalationConditions: ["Cualquier pregunta legal, contractual o de permanencia."],
    requiresHumanReview: true,
    version: "contract-human-review-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  },
  {
    id: "contract-termination-content-use-draft",
    category: "CONTRACT_POLICY",
    title: "Finalizacion sin preaviso y uso de contenido",
    facts: [
      "Existe un preaviso previsto de un mes.",
      "La intencion actual ante abandono sin preaviso es poder usar durante un mes adicional solo contenido previamente autorizado.",
      "Despues de ese mes debe dejar de utilizarse salvo autorizacion contractual diferente."
    ],
    approvedAnswerPoints: ["Esta parte esta pendiente de revision legal y la explicaria Alex en el contrato."],
    prohibitedClaims: [
      "Presentarlo como clausula definitiva.",
      "Afirmar uso ilimitado de contenido.",
      "Dar asesoramiento legal."
    ],
    allowedStates: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "CALL_SCHEDULED"],
    tags: ["termination", "content-rights", "legal-review"],
    mandatoryNuances: ["Debe permanecer en revision legal.", "El bot no debe explicarlo como definitivo."],
    escalationConditions: ["Cualquier pregunta sobre uso de contenido tras finalizar la relacion."],
    requiresHumanReview: true,
    version: "contract-termination-content-use-2026-06-09.1",
    status: "DRAFT_LEGAL_REVIEW_REQUIRED",
    approvedByAlex: false,
    updatedAt: "2026-06-09"
  }
];

export const contractPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
