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
      "Ante DUDA o verguenza inicial ('me da corte', 'soy timida', 'y si me reconocen'), se TRANQUILIZA y se sigue intentando con tacto (a muchas al principio les da respeto y es lo mas normal): NUNCA se ofrece dejarlo por una duda.",
      "Solo si la candidata RECHAZA EN FIRME mostrar la cara se rechaza de forma educada y breve, dejando la puerta abierta por si cambia de opinion."
    ],
    approvedAnswerPoints: [
      "A muchas al principio les da un poco de corte, es de lo mas normal.",
      "La cara es justo lo que genera la confianza del cliente y el trafico, por eso es imprescindible.",
      "Se lleva con naturalidad y estamos contigo en todo el proceso.",
      "Rechazo educado SOLO si RECHAZA EN FIRME, en cuatro mensajes: 'Entiendo' / 'Pero es nuestra manera de trabajar' / 'Asi que no podemos trabajar contigo lamentablemente' / 'Espero que te vaya genial, un saludo'."
    ],
    prohibitedClaims: [
      "Ofrecer trabajo anonimo o una modalidad sin mostrar la cara.",
      "Prometer difuminar, tapar o recortar la cara como alternativa.",
      "Ofrecer dejarlo, cerrar o despedirse ante una simple DUDA o verguenza: solo se rechaza ante un rechazo EN FIRME.",
      "Presionar de forma agresiva; o insistir despues de que RECHACE EN FIRME.",
      "Dar motivos fisicos o valoraciones personales en el rechazo."
    ],
    mandatoryNuances: [
      "Ante duda/verguenza: tranquilizar (es normal, a muchas les pasa, es lo que da confianza) e insistir con tacto en seguir; NUNCA ofrecer dejarlo por una duda.",
      "El rechazo educado SOLO ante rechazo EN FIRME de mostrar la cara, dejando la puerta abierta.",
      "El rechazo se limita a la politica de trabajo, nunca a valoraciones de la candidata."
    ],
    escalationConditions: [
      "La candidata propone condiciones especiales, como mostrar la cara solo en parte del contenido.",
      "La candidata vuelve mas tarde aceptando mostrar la cara: Alex decide si se retoma el proceso."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED"],
    tags: ["face", "anonymity", "boundaries", "requirement", "rejection-script"],
    requiresHumanReview: false,
    // 2026-07-08 (Alex, revision total voz): ante DUDA/verguenza NO se ofrece dejarlo -> se tranquiliza e insiste
    // con tacto ("no queremos que lo deje nunca, hay que intentarlo"); el rechazo educado SOLO ante rechazo EN
    // FIRME. Se reencuadran facts/answerPoints/nuances para liderar con tranquilizacion; misma politica de fondo
    // (la cara sigue siendo imprescindible, sin anonimato).
    version: "face-requirement-mandatory-2026-07-08.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-08"
  }
];

export const faceRequirementPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
