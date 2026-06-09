import { CandidateDeviceRequirementSchema, KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

export const candidateDeviceRequirement = CandidateDeviceRequirementSchema.parse({
  requiredDevice: "HIGH_QUALITY_PHONE",
  isMandatory: true,
  mustBeConfirmedBeforeHumanFinalApproval: true,
  approvedQuestion: "Por cierto, una cosa importante: que movil tienes?",
  rejectionOrPausePolicy:
    "iPhone 13 o superior y Galaxy S23 o superior estan aprobados directamente. iPhone anterior al 13, otros Samsung y otros moviles de gama alta requieren prueba manual de calidad. Si va a comprar un dispositivo valido, puede hacerse llamada pero la incorporacion queda pendiente. Moviles de mala calidad bloquean la incorporacion.",
  version: "candidate-device-eligibility-2026-06-09.2"
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
  },
  {
    id: "candidate-requirements-device-quality",
    category: "CANDIDATE_REQUIREMENTS",
    title: "Dispositivo valido",
    facts: [
      "iPhone 13 o superior esta aprobado directamente.",
      "iPhone anterior al 13 requiere prueba manual de calidad.",
      "Samsung Galaxy S23, S24, S25 o superior esta aprobado directamente.",
      "Otros Samsung y otros moviles de gama alta requieren prueba manual de calidad.",
      "Moviles de mala calidad bloquean la incorporacion.",
      "Si va a comprar un iPhone, puede hacerse la llamada pero la incorporacion queda pendiente."
    ],
    approvedAnswerPoints: [
      "Por cierto, una cosa importante: que movil tienes?",
      "iPhone 13 o superior y Galaxy S23 o superior nos sirven directamente.",
      "Si es iPhone anterior al 13, otro Samsung u otro movil de gama alta, Alex revisa la calidad."
    ],
    prohibitedClaims: ["Aprobar incorporacion con movil de mala calidad.", "Decir que cualquier Android sirve.", "Bloquear automaticamente un Galaxy S23 o superior."],
    mandatoryNuances: ["Preguntar de forma natural durante la cualificacion.", "Distinguir llamada de incorporacion final."],
    escalationConditions: ["iPhone anterior al 13 u otro movil de gama alta requiere prueba manual.", "Compra futura deja incorporacion pendiente.", "No responde claramente."],
    allowedStates: ["QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["device", "quality", "qualification", "iphone", "galaxy"],
    requiresHumanReview: false,
    version: "candidate-requirements-device-quality-2026-06-09.2",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "candidate-requirements-target-profile",
    category: "CANDIDATE_REQUIREMENTS",
    title: "Perfil objetivo y revision fisica humana",
    facts: [
      "Las campanas actuales se dirigen a Argentina.",
      "La edad habitual buscada esta entre 30 y 50 anos y perfil maduro.",
      "No es obligatorio tener seguidores, experiencia ni OnlyFans activo.",
      "La valoracion fisica la realiza unicamente Alex."
    ],
    approvedAnswerPoints: ["No hace falta tener seguidores ni experiencia para que podamos valorarlo.", "La revision final del perfil la hace Alex."],
    prohibitedClaims: ["Puntuar atractivo.", "Analizar el cuerpo.", "Comunicar motivos fisicos de rechazo.", "Usar criterios como cara espanola."],
    mandatoryNuances: ["El chatbot recopila datos y pasa el perfil a revision humana."],
    escalationConditions: ["Cualquier valoracion fisica o duda de encaje visual."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_HUMAN_REVIEW"],
    tags: ["target-profile", "physical-review", "followers", "experience"],
    requiresHumanReview: false,
    version: "candidate-requirements-target-profile-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const candidateRequirementEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
