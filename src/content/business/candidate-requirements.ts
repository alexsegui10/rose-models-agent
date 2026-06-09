import { CandidateDeviceRequirementSchema, KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

export const candidateDeviceRequirement = CandidateDeviceRequirementSchema.parse({
  requiredDevice: "IPHONE",
  isMandatory: true,
  mustBeConfirmedBeforeHumanFinalApproval: true,
  approvedQuestion: "Por cierto, una cosa importante: ¿tienes iPhone?",
  rejectionOrPausePolicy:
    "Si la candidata no tiene iPhone, no puede pasar a aprobacion final. Se pausa o se deriva a revision humana si indica que puede cambiarlo pronto; no se inventan excepciones.",
  version: "candidate-device-iphone-2026-06-09.1"
});

const entries: KnowledgeEntryInput[] = [
  {
    id: "candidate-requirements-adult",
    category: "CANDIDATE_REQUIREMENTS",
    title: "Solo mayores de edad",
    facts: ["Rose Models solo puede valorar candidatas mayores de edad."],
    approvedAnswerPoints: ["Ahora mismo solo podemos valorar perfiles de personas mayores de edad."],
    prohibitedClaims: ["Continuar el proceso con una menor.", "Pedir documentacion sensible por chat inicial."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_PROFILE_ACCESS"],
    tags: ["age", "adult", "safety"],
    requiresHumanReview: false,
    version: "candidate-adult-requirement-2026-06-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-08"
  }
  ,
  {
    id: "candidate-requirements-iphone",
    category: "CANDIDATE_REQUIREMENTS",
    title: "iPhone obligatorio",
    facts: ["Tener iPhone es requisito obligatorio para trabajar con Rose Models."],
    approvedAnswerPoints: [
      "Por cierto, una cosa importante: ¿tienes iPhone?",
      "Para trabajar con nosotros es necesario tener iPhone, porque parte del sistema y del contenido lo gestionamos desde ahi."
    ],
    prohibitedClaims: ["Aprobar a una candidata sin iPhone confirmado.", "Inventar excepciones al requisito de iPhone.", "Prometer que Android sirve igualmente."],
    mandatoryNuances: ["Preguntar de forma natural durante la cualificacion.", "No hacer una explicacion larga salvo que pregunte por que."],
    escalationConditions: ["La candidata tiene Android u otro dispositivo.", "La candidata dice que comprara un iPhone pronto.", "No responde claramente."],
    allowedStates: ["QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["iphone", "device", "requirement", "qualification"],
    requiresHumanReview: false,
    version: "candidate-requirements-iphone-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const candidateRequirementEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
