import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "face-requirement-mandatory",
    category: "CANDIDATE_REQUIREMENTS",
    title: "Mostrar la cara es imprescindible, sin opcion de anonimato",
    facts: [
      "Mostrar la cara es imprescindible para la estrategia de trafico y monetizacion de Rose Models.",
      "Mostrar la cara da mucha mas confianza al cliente.",
      "No es posible trabajar en anonimato ni trabajar sin mostrar la cara.",
      "Si la candidata no acepta mostrar la cara, se rechaza de forma educada y breve, dejando la puerta abierta por si cambia de opinion."
    ],
    approvedAnswerPoints: [
      "La cara es imprescindible para nuestra estrategia.",
      "Es imprescindible para generar el trafico.",
      "Da mucha mas confianza al cliente.",
      "Rechazo educado en cuatro mensajes si no acepta: 'Entiendo' / 'Pero es nuestra manera de trabajar' / 'Asi que no podemos trabajar contigo lamentablemente' / 'Espero que te vaya genial, un saludo'."
    ],
    prohibitedClaims: [
      "Ofrecer trabajo anonimo o una modalidad sin mostrar la cara.",
      "Prometer difuminar, tapar o recortar la cara como alternativa.",
      "Presionar o insistir despues de que rechace mostrar la cara.",
      "Dar motivos fisicos o valoraciones personales en el rechazo."
    ],
    mandatoryNuances: [
      "Si rechaza mostrar la cara, despedirse de forma educada y dejar la puerta abierta por si cambia de opinion.",
      "El rechazo se limita a la politica de trabajo, nunca a valoraciones de la candidata."
    ],
    escalationConditions: [
      "La candidata propone condiciones especiales, como mostrar la cara solo en parte del contenido.",
      "La candidata vuelve mas tarde aceptando mostrar la cara: Alex decide si se retoma el proceso."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED"],
    tags: ["face", "anonymity", "boundaries", "requirement", "rejection-script"],
    requiresHumanReview: false,
    // 2026-07-02: solo ortografia ("Si es" ambiguo leido por TTS -> "Es imprescindible"; "trabjar"):
    // misma politica aprobada, cero cambios de significado.
    version: "face-requirement-mandatory-2026-07-02.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-02"
  }
];

export const faceRequirementPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
