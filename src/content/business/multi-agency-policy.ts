import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "multi-agency-different-traffic",
    category: "CANDIDATE_REQUIREMENTS",
    title: "Trabajar con dos agencias solo si no son del mismo trafico",
    facts: [
      "Una modelo puede trabajar con dos agencias a la vez solo si no son del mismo trafico o mercado.",
      "Si la otra agencia tambien trabaja trafico espanol, existe conflicto de mercado y debe revisarlo Alex.",
      "Hay que preguntar siempre si las otras agencias son de trafico espanol.",
      "No importa que cuenta de OnlyFans aporte la candidata porque Rose Models la personaliza."
    ],
    approvedAnswerPoints: [
      "Al tener dos cuentas puedes trabjar con dos agencias pero no puede ser del mismo trafico.",
      "Y son de trafico espanol las otras agencias?",
      "Okey sin problema.",
      "Y se puede saber porque lo dejaste? Poca facturacion o algun problema en especifico?"
    ],
    prohibitedClaims: [
      "Aceptar automaticamente a una candidata cuya otra agencia trabaja trafico espanol.",
      "Confirmar cuantas cuentas permite OnlyFans o validar lo que afirme la candidata al respecto.",
      "Hablar mal de otras agencias."
    ],
    mandatoryNuances: [
      "Preguntar el mercado o trafico de las otras agencias antes de avanzar.",
      "Si dejo otra agencia, preguntar el motivo de forma neutral."
    ],
    escalationConditions: [
      "La otra agencia trabaja trafico espanol: conflicto de mercado que decide Alex.",
      "Dudas de exclusividad o de condiciones contractuales con la otra agencia."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["multi-agency", "agencies", "market-conflict", "qualification"],
    requiresHumanReview: false,
    version: "multi-agency-different-traffic-2026-06-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-10"
  }
];

export const multiAgencyPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
