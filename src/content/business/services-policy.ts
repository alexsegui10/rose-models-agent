import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "services-agency-management",
    category: "SERVICES",
    title: "Servicios principales de la agencia",
    facts: [
      "La agencia se encarga de estrategia, trafico, monetizacion, chatting y gestion acordada.",
      "La modelo solo manda el contenido; la agencia hace el trafico creando cuentas de Instagram con ubicaciones y nombres españoles, y al llegar a bastantes seguidores pone el link al OnlyFans y monetiza con un equipo de chatters 24/7."
    ],
    approvedAnswerPoints: [
      // Pitch confirmado por Alex (14-jun): mecanismo real (cuentas de Instagram españolas -> seguidores
      // -> link al OF -> monetizacion con chatters). Se entrega tambien PROACTIVAMENTE cuando la
      // candidata NO ha trabajado con agencias (no sabe en que consiste lo de la agencia), no solo si
      // pregunta "como trabajais". TROCEADO en burbujas CORTAS (Alex 22-jun: los parrafos largos quedan muy
      // de robot). Se mantiene en ~5 piezas: el techo de rafaga de Instagram (~9s, pausas capadas a 4.5s)
      // no entrega bien mas de ~5 burbujas por turno.
      // Arranque suavizado (Alex 14-jul): "Vale pues, te voy a explicar de forma breve...". Se MANTIENE la
      // coletilla "cualquier duda me preguntas" (Alex 14-jul lo confirmo). El cierre "lo comento con mi socio"
      // NO va en el pitch: lo pone el codigo en el MENSAJE SIGUIENTE cuando ella responde/pregunta.
      "Vale pues, te voy a explicar de forma breve como trabajamos: tu solo te encargas de mandar el contenido.",
      "Nosotros hacemos el resto: la monetizacion, el trafico y toda la gestion.",
      "El trafico lo hacemos con cuentas de instagram que creamos con ubicaciones y nombres españoles.",
      "Al tener bastantes seguidores ponemos el link a tu of y empezamos a monetizar con el equipo de chatters 24/7.",
      "En la llamada te lo explico todo mejor.",
      // Cierre calido del pitch en su PROPIA burbuja (peticion de Alex 7-jul, mantenida 14-jul): tras explicar
      // como trabajamos, invita a preguntar sin presionar, como mensaje aparte.
      "Si tienes cualquier duda me preguntas sin problema."
    ],
    prohibitedClaims: [
      "Prometer resultados concretos.",
      "Afirmar servicios no documentados como fotografia, viajes o contratos externos."
    ],
    // Respondible tambien en HUMAN_INTERVENTION_REQUIRED y en WAITING_HUMAN_REVIEW: el pitch operativo (como
    // trabajamos) nunca debe derivarse al socio, ni siquiera mientras el bot espera el Encaja de Alex. Antes,
    // en WAITING_HUMAN_REVIEW la ficha quedaba gateada y un "y como trabajais?" se contestaba con "eso lo hablo
    // con mi socio y te digo" (defer de una duda que el bot SI sabe): justo lo que Alex NO quiere (7-jul).
    allowedStates: [
      "NEW_LEAD",
      "QUALIFYING",
      "APPROVED",
      "COLLECTING_CALL_DETAILS",
      "HUMAN_INTERVENTION_REQUIRED",
      "WAITING_HUMAN_REVIEW"
    ],
    tags: ["services", "agency", "strategy", "traffic", "monetization"],
    mandatoryNuances: ["No prometer resultados.", "No inventar servicios concretos no documentados."],
    escalationConditions: ["La candidata pide resultados garantizados.", "La candidata pregunta por servicios no documentados."],
    requiresHumanReview: false,
    version: "services-agency-management-2026-07-14.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-14"
  }
];

export const servicesPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
