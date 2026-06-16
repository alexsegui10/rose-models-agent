import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";
import { communicationPolicy, contentProductionPolicy } from "@/domain/businessPolicy";

export { communicationPolicy, contentProductionPolicy };

const entries: KnowledgeEntryInput[] = [
  {
    id: "content-agency-responsibilities",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Responsabilidades de Rose Models",
    facts: [
      "Rose Models crea cuentas nuevas de Instagram y sus correos.",
      "Rose Models utiliza telefonos y SIM preparados para esas cuentas.",
      "Rose Models controla las cuentas nuevas de Instagram.",
      "Rose Models edita y publica Reels.",
      "Rose Models gestiona estrategia, crecimiento, trafico, chatting, precios, PPV, monetizacion y operativa.",
      "Rose Models gestiona la cuenta de OnlyFans junto con la modelo y utiliza Inflow como CRM.",
      "Las cuentas previas o personales de Instagram de la modelo no se usan como cuenta principal del proyecto."
    ],
    approvedAnswerPoints: [
      "Nosotros nos encargamos de la parte operativa: cuentas, estrategia, publicacion, trafico, chatting y monetizacion.",
      "No usamos tu Instagram personal como cuenta principal del proyecto."
    ],
    prohibitedClaims: [
      "Pedir contrasenas por chat.",
      "Guardar contrasenas en prompts o logs.",
      "Prometer una fecha exacta de ingresos."
    ],
    mandatoryNuances: ["Responder breve por chat y dejar detalles para llamada."],
    escalationConditions: ["Preguntas de acceso, contrasenas o dudas contractuales."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["agency-responsibilities", "instagram", "onlyfans", "operations"],
    requiresHumanReview: false,
    version: "content-agency-responsibilities-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  },
  {
    id: "content-model-responsibilities",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Responsabilidades de la modelo",
    facts: [
      "La modelo crea contenido nuevo.",
      "La modelo sube contenido a una carpeta compartida de Google Drive.",
      "La modelo sigue perfiles de referencia para Instagram y guiones para OnlyFans.",
      "La modelo comunica sus limites.",
      "La modelo debe responder al equipo en un maximo habitual de 48 horas.",
      "Un retraso aislado no implica rechazo automatico.",
      "Retrasos repetidos requieren revision humana."
    ],
    approvedAnswerPoints: [
      "Tu parte seria crear contenido, subirlo a Drive, seguir referencias o guiones y decirnos tus limites.",
      // Sin SLA corporativo ("responder al equipo en unas 48 horas" era el mensaje mas fuera de voz
      // segun los jueces): misma politica, registro de Alex.
      "Lo unico es no tardar mucho en contestar, un dia o dos como mucho."
    ],
    prohibitedClaims: [
      "Presionarla para cambiar limites.",
      "Rechazarla por un retraso aislado.",
      "Pedir contenido intimo por Instagram."
    ],
    mandatoryNuances: ["No decir que la modelo solo envia contenido.", "Los detalles completos se explican mejor en llamada."],
    escalationConditions: ["Retrasos repetidos.", "Dudas sobre limites o condiciones especiales."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["model-responsibilities", "content", "availability", "drive"],
    requiresHumanReview: false,
    version: "content-model-responsibilities-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  },
  {
    id: "content-production-volume",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Contenido inicial y recurrente",
    facts: [
      `La fase inicial dura aproximadamente ${contentProductionPolicy.warmupDays} dias.`,
      `En la fase inicial se preparan ${contentProductionPolicy.warmupPhotosPerDayMin} o ${contentProductionPolicy.warmupPhotosPerDayMax} fotos diarias.`,
      `El objetivo orientativo posterior es de ${contentProductionPolicy.targetReelsPerWeekMin} a ${contentProductionPolicy.targetReelsPerWeekMax} Reels semanales.`,
      "Ese rango no esta confirmado como minimo contractual rigido."
    ],
    approvedAnswerPoints: [
      "Al principio suelen ser unos cinco dias con 2 o 3 fotos diarias.",
      "Despues el objetivo orientativo es 10 a 20 Reels semanales, pero no lo trataria como minimo contractual cerrado por chat."
    ],
    prohibitedClaims: ["Presentar 10-20 Reels como obligacion contractual rigida.", "Cerrar condiciones contractuales por chat."],
    mandatoryNuances: ["Puede ir preparando Reels desde el principio.", "Alex organiza los detalles despues de la llamada."],
    escalationConditions: ["Quiere cerrar obligaciones contractuales exactas."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["production", "reels", "photos", "warmup"],
    requiresHumanReview: false,
    version: "content-production-volume-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "content-new-and-old-material",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Contenido nuevo y material antiguo",
    facts: [
      "Para Instagram el contenido debe ser nuevo y no publicado antes.",
      "Para OnlyFans pueden reutilizarse fotos, videos o sextings antiguos si sirven.",
      "La reutilizacion de material antiguo solo se menciona si la candidata pregunta."
    ],
    approvedAnswerPoints: [
      "Para Instagram necesitamos contenido nuevo.",
      "Para OnlyFans se puede aprovechar material antiguo si sirve, pero eso lo vemos segun el caso."
    ],
    prohibitedClaims: ["Usar material antiguo en Instagram.", "Mencionar material antiguo de OnlyFans de forma proactiva."],
    mandatoryNuances: ["Solo explicar reutilizacion si pregunta."],
    escalationConditions: ["Dudas sobre derechos de contenido o contrato."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["new-content", "old-material", "instagram", "onlyfans"],
    requiresHumanReview: false,
    version: "content-new-and-old-material-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "content-boundaries-neutral-question",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Limites de contenido",
    facts: [
      "Los limites se preguntan de forma neutral.",
      "No se presiona a la modelo para cambiarlos.",
      "Los detalles completos se tratan en llamada y Alex gestiona guiones despues."
    ],
    approvedAnswerPoints: ["Hay algun tipo de contenido que no quieras hacer o algun limite que debamos tener en cuenta?"],
    prohibitedClaims: ["Presionar para cambiar limites.", "Entrar en descripciones innecesariamente explicitas por Instagram."],
    mandatoryNuances: ["Registrar limites.", "Si necesita ejemplos, usar categorias profesionales y breves."],
    escalationConditions: ["Detalles explicitos o dudas sensibles."],
    allowedStates: ["QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["boundaries", "limits", "content"],
    requiresHumanReview: false,
    version: "content-boundaries-neutral-question-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const contentResponsibilityEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
