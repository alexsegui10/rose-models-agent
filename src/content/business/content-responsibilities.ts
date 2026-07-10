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
    // Drive/guiones/limites FUERA del texto (orden de Alex 6-jul, caso Constanza): son detalles
    // operativos que se explican en la llamada o despues, jamas en el chat de Instagram.
    facts: [
      "La modelo crea contenido nuevo y se lo envia al equipo.",
      "Los perfiles de referencia se pasan por WhatsApp.",
      "La modelo crea ella misma su cuenta de OnlyFans; si tiene dudas, el equipo la guia.",
      "Los detalles operativos completos se explican en la llamada.",
      "La modelo debe responder al equipo en un maximo habitual de 48 horas.",
      "Un retraso aislado no implica rechazo automatico.",
      "Retrasos repetidos requieren revision humana."
    ],
    approvedAnswerPoints: [
      "Tu parte seria crear el contenido y enviarnoslo, nosotros nos encargamos del resto.",
      "Los perfiles de referencia te los pasamos por WhatsApp, tanto para Instagram como para OnlyFans.",
      "La cuenta de OnlyFans la creas tu, es sencillo, y si tienes cualquier duda te vamos guiando.",
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
    tags: ["model-responsibilities", "content", "availability", "whatsapp", "onlyfans"],
    requiresHumanReview: false,
    version: "content-model-responsibilities-2026-07-01.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-01"
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
    id: "content-time-commitment",
    category: "CONTENT_RESPONSIBILITIES",
    title: "Tiempo de dedicacion",
    facts: [
      "No se necesita jornada completa: con unas horas al dia es suficiente.",
      "Lo importante es cumplir con el contenido acordado, no un horario fijo.",
      "Se puede compaginar con otro trabajo o estudios."
    ],
    approvedAnswerPoints: [
      "No necesitas jornada completa, con dedicarle unas horas al dia es suficiente.",
      "Lo importante es que cumplas con el contenido que te vayamos pidiendo, lo puedes compaginar con otra cosa."
    ],
    prohibitedClaims: ["Prometer un horario fijo exacto.", "Decir que es sin esfuerzo o dinero facil."],
    mandatoryNuances: ["Solo se explica el tiempo de dedicacion si la candidata lo pregunta."],
    escalationConditions: ["Pide garantias de horario o condiciones de jornada por escrito."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["availability", "time-commitment", "content"],
    requiresHumanReview: false,
    version: "content-time-commitment-2026-06-16.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-16"
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
    approvedAnswerPoints: [
      "Hay algun tipo de contenido que no quieras hacer o algun limite que debamos tener en cuenta?",
      "Los limites son sobre el contenido intimo: practicas o escenas concretas que no quieras hacer.",
      "Lo que digas que no quieres hacer se respeta siempre, sin pedirte explicaciones."
    ],
    prohibitedClaims: ["Presionar para cambiar limites.", "Entrar en descripciones innecesariamente explicitas por Instagram."],
    mandatoryNuances: ["Registrar limites.", "Si necesita ejemplos, usar categorias profesionales y breves."],
    escalationConditions: ["Detalles explicitos o dudas sensibles."],
    // QUALIFYING FUERA (caso real Brenda 5-jul): la palabra "contenido" en su mensaje surfaceaba esta
    // entrada y el bot le PREGUNTABA los limites en mitad de la cualificacion, sin venir a cuento. Los
    // limites se tratan en la llamada (guion v2, 3-jul); en texto solo si ella pregunta tras el Encaja.
    allowedStates: ["APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["boundaries", "limits", "content"],
    requiresHumanReview: false,
    // 2026-07-03 (Alex): definicion clara de "limites" para la llamada ("limite de que?" quedaba deferido).
    version: "content-boundaries-neutral-question-2026-07-03.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-03"
  },
  {
    // Decision de Alex (10-jul, sweep R9): la EDICION la hace la agencia; ella manda el material en crudo.
    // Antes "¿las fotos las edito yo o vosotros?" se respondia con un volcado de calendario que no contestaba.
    id: "content-editing-by-agency",
    category: "CONTENT_RESPONSIBILITIES",
    title: "La edicion del contenido la hace la agencia",
    facts: [
      "La edicion y el retoque del contenido los hace la agencia.",
      "La candidata envia el material en crudo (fotos y videos tal cual los graba)."
    ],
    approvedAnswerPoints: [
      "De la edicion nos encargamos nosotros: tu nos mandas el material en crudo y nuestro equipo lo deja listo.",
      "No necesitas saber editar ni tener programas de edicion."
    ],
    prohibitedClaims: [
      "Pedirle que aprenda edicion o que compre programas.",
      "Prometer retoques que alteren su fisico de forma enganosa."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["editing", "production", "content"],
    requiresHumanReview: false,
    version: "content-editing-by-agency-2026-07-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-10"
  },
  {
    // Decision de Alex (10-jul, sweep R9): ante "¿mis hijos no salen en nada, no?" el NO es ROTUNDO e
    // inmediato (antes se deferia a WhatsApp con un "No, tranquila... lo confirmo" que dejaba la duda
    // abierta a una madre). Compliance: menores JAMAS en ningun contenido.
    id: "content-only-her-no-minors",
    category: "CONTENT_RESPONSIBILITIES",
    title: "En el contenido aparece solo ella: menores y terceros JAMAS",
    facts: [
      "En el contenido aparece UNICAMENTE la candidata.",
      "Menores JAMAS aparecen en ningun contenido, bajo ninguna circunstancia.",
      "Terceros (pareja, familia, amigos) no aparecen en el contenido."
    ],
    approvedAnswerPoints: [
      "No, jamas: en el contenido apareces solo tu.",
      "Menores nunca aparecen en nada, eso es sagrado e innegociable."
    ],
    prohibitedClaims: [
      "Dejar la respuesta en el aire o deferirla: el NO es rotundo e inmediato.",
      "Sugerir que terceros o menores podrian aparecer en algun caso."
    ],
    mandatoryNuances: ["La respuesta sobre menores es un NO categorico inmediato; jamas se defiere ni se matiza."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["minors-content", "only-her", "content", "safety"],
    requiresHumanReview: false,
    version: "content-only-her-no-minors-2026-07-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-10"
  }
];

export const contentResponsibilityEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
