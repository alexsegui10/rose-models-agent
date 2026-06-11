import { KnowledgeEntrySchema, RevenueSharePolicySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

export const activeRevenueSharePolicy = RevenueSharePolicySchema.parse({
  agencyPercentage: 70,
  modelPercentage: 30,
  isConfirmed: true,
  discloseOnlyWhenExplicitlyAsked: true,
  canExplainNoFixedSalaryInChat: true,
  canDiscloseExactPercentagesInChat: true,
  canNegotiateByChat: false,
  negotiationRequiresHumanReview: true,
  approvedGeneralExplanation:
    "No funciona como un salario fijo. Va por reparto y los detalles concretos se explican mejor en llamada.",
  approvedPercentageExplanation: "El reparto estandar es 70% para Rose Models y 30% para la modelo.",
  minimumAgencyPercentage: 60,
  maximumModelPercentage: 40,
  calculationBasis: "NET_AFTER_PLATFORM_COMMISSION",
  platformPayoutRecipient: "MODEL",
  paymentMethodToAgency: "SKRILL",
  settlementIntervalDays: 14,
  settlementStartsFromFirstRevenue: true,
  alexCalculatesSettlementManually: true,
  version: "commercial-revenue-share-2026-06-09.2"
});

const entries: KnowledgeEntryInput[] = [
  {
    id: "commercial-no-fixed-salary",
    category: "COMMERCIAL",
    title: "Rose Models no trabaja con salario fijo",
    facts: ["Rose Models no trabaja mediante salario fijo.", "El modelo comercial se explica con detalle durante la llamada."],
    approvedAnswerPoints: [
      "No funciona como un salario fijo.",
      "Va por reparto.",
      "Los detalles se explican mejor en llamada para que quede claro."
    ],
    prohibitedClaims: [
      "Prometer un sueldo mensual.",
      "Prometer ingresos garantizados.",
      "Dar cifras de ganancias.",
      "Ofrecer proactivamente un salario fijo o un rango de sueldo (anomalia real de un chat que no debe repetirse): toda negociacion salarial se escala a revision humana."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["salary", "commercial", "payment"],
    requiresHumanReview: false,
    version: "commercial-no-fixed-salary-2026-06-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-10"
  },
  {
    id: "commercial-revenue-share-general",
    category: "COMMERCIAL",
    title: "Modelo general de reparto porcentual",
    facts: [
      "Rose Models trabaja mediante reparto porcentual.",
      "No existe salario fijo.",
      "El porcentaje no se menciona de forma proactiva.",
      "El reparto estandar confirmado es 70% para Rose Models y 30% para la modelo.",
      "El calculo se realiza sobre el ingreso neto despues de la comision de la plataforma.",
      "La modelo recibe directamente el dinero de la plataforma.",
      "Alex calcula manualmente cada liquidacion.",
      "La modelo paga a Rose Models mediante Skrill.",
      "La liquidacion se realiza cada 14 dias desde la primera fecha en que la cuenta genera ingresos.",
      "Los detalles comerciales se explican principalmente durante la llamada.",
      "El agente no puede negociar porcentajes por chat."
    ],
    approvedAnswerPoints: [
      "Va por reparto, no por salario fijo.",
      "Si preguntas por la cifra exacta: 70% para Rose Models y 30% para ti.",
      "Se calcula sobre el neto despues de la comision de la plataforma."
    ],
    prohibitedClaims: [
      "Mencionar el porcentaje de forma proactiva.",
      "Negociar un porcentaje por chat.",
      "Ofrecer 65/35 o 60/40 por chat.",
      "Prometer ingresos garantizados.",
      "Repetir la anomalia real '75% agencia / 25% para ti': ese reparto no existe y nunca debe mencionarse.",
      "Ofrecer proactivamente un salario fijo o cifras de sueldo."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["percentage", "revenue-share"],
    mandatoryNuances: [
      "No mencionar porcentajes si la candidata no pregunta.",
      "No negociar por chat.",
      "No dar explicaciones largas."
    ],
    escalationConditions: [
      "La candidata pide excepciones.",
      "La candidata negocia un porcentaje.",
      "La candidata pide condiciones fuera de la politica."
    ],
    requiresHumanReview: false,
    version: "commercial-revenue-share-general-2026-06-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-10"
  },
  {
    id: "commercial-revenue-share-settlement",
    category: "COMMERCIAL",
    title: "Liquidacion y pago a Rose Models",
    facts: [
      "La liquidacion se realiza cada 14 dias desde la primera fecha en que la cuenta genera ingresos.",
      "La modelo recibe el dinero de la plataforma.",
      "La modelo paga a Rose Models mediante Skrill.",
      "Alex calcula manualmente cada liquidacion."
    ],
    approvedAnswerPoints: [
      "La liquidacion va cada 14 dias desde que la cuenta genera ingresos.",
      "La plataforma te paga a ti y despues se paga a Rose Models por Skrill.",
      "Alex calcula cada liquidacion manualmente."
    ],
    prohibitedClaims: [
      "Prometer automatizacion de pagos.",
      "Pedir datos de pago sensibles por chat inicial.",
      "Prometer una fecha exacta de ingresos."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["settlement", "skrill", "payment", "revenue-share"],
    mandatoryNuances: ["Explicar solo si pregunta.", "No pedir informacion sensible de pago en esta fase."],
    escalationConditions: ["Pide excepciones de pago.", "Pide condiciones no previstas."],
    requiresHumanReview: false,
    version: "commercial-revenue-share-settlement-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "commercial-why-agency-70",
    category: "COMMERCIAL",
    title: "Explicacion breve del 70% para Rose Models",
    facts: [
      "Rose Models gestiona creacion y crecimiento de cuentas, trafico, contenido publicado, chatting, monetizacion, estrategia y gestion operativa."
    ],
    approvedAnswerPoints: [
      "Porque Rose Models se encarga de la parte operativa: cuentas, trafico, publicacion, chatting, monetizacion y estrategia."
    ],
    prohibitedClaims: ["Dar una explicacion excesivamente larga.", "Prometer resultados concretos."],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["percentage", "why-70", "services"],
    mandatoryNuances: ["Responder breve.", "No prometer ingresos."],
    escalationConditions: ["La candidata discute o negocia condiciones."],
    requiresHumanReview: false,
    version: "commercial-why-agency-70-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  },
  {
    id: "commercial-non-payment",
    category: "COMMERCIAL",
    title: "Impagos",
    facts: [
      "Alex comunica manualmente el importe.",
      "Si no paga, recibe un recordatorio.",
      "Tiene siete dias adicionales.",
      "Si continua sin pagar, se suspende el servicio.",
      "Puede finalizarse la relacion y reclamarse la deuda.",
      "El impago no concede uso ilimitado del contenido."
    ],
    approvedAnswerPoints: [
      "Si hubiera un impago, primero se recuerda y hay siete dias adicionales antes de suspender el servicio.",
      "El impago no da derecho a uso ilimitado del contenido."
    ],
    prohibitedClaims: ["Conceder uso ilimitado del contenido por impago.", "Amenazar por chat.", "Dar asesoramiento legal."],
    allowedStates: ["APPROVED", "COLLECTING_CALL_DETAILS", "READY_TO_SCHEDULE", "CALL_SCHEDULED"],
    tags: ["non-payment", "debt", "payment"],
    mandatoryNuances: ["No convertirlo en asesoramiento legal.", "Escalar dudas contractuales."],
    escalationConditions: ["Discusion legal.", "Excepciones de pago."],
    requiresHumanReview: false,
    version: "commercial-non-payment-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const commercialPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
