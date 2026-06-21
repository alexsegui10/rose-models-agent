/**
 * Agenda de la llamada de voz: las etapas SUSTANTIVAS que el bot recorre proactivamente, en orden.
 *
 * Es el "guion" como DATOS (no texto fijo): cada etapa declara su objetivo y a qué entradas de
 * conocimiento de negocio se apoya. El director (`callDirector.ts`) decide cuándo avanzar; la
 * redacción concreta la hace la capa de voz reutilizando el conocimiento referenciado.
 *
 * La apertura legal (declarar IA + grabación) NO es una etapa de agenda: es un paso 0 obligatorio que
 * gestiona el director aparte. El cierre ("te paso el contrato") sí es la última etapa.
 *
 * Confirmado por Alex (16-jun-2026): objetivo de la llamada = explicar + generar confianza + dejar el
 * siguiente paso (enviar el contrato). NO se cierra compromiso firme en la llamada.
 */

export type CallAgendaStageId =
  | "HOW_AGENCY_WORKS"
  | "HER_RESPONSIBILITIES"
  | "CONTENT_AND_FACE"
  | "MONEY"
  | "BOUNDARIES"
  | "CLOSE";

export interface CallAgendaStage {
  id: CallAgendaStageId;
  /** Posición en el recorrido proactivo (1 = primera). */
  order: number;
  /** Etiqueta en español para trazas/UI. */
  label: string;
  /** Qué busca esta etapa (para el director y para la redacción). */
  objective: string;
  /** ids de entradas de `businessKnowledgeEntries` que sustentan esta etapa (pueden estar vacías si es puro guion). */
  knowledgeRefs: string[];
}

/**
 * Agenda en orden. El dinero se presenta proactivamente y FRESCO en la llamada (70/30, sin dar por
 * hecho que se dijo por Instagram); la negociación a la baja solo se activa si la candidata se queja
 * (la decide el código vía `callNegotiation.ts`, nunca esta agenda).
 */
export const CALL_AGENDA: readonly CallAgendaStage[] = [
  {
    id: "HOW_AGENCY_WORKS",
    order: 1,
    label: "Cómo trabaja la agencia",
    objective:
      "Explicar el modelo: cuentas de Instagram españolas que generan tráfico, link a tu OnlyFans, equipo de chatters 24/7, monetización y gestión; tú solo mandas contenido.",
    knowledgeRefs: [
      "services-agency-management",
      "content-agency-responsibilities",
      "geo-privacy-three-layers",
      "services-secondary-traffic"
    ]
  },
  {
    id: "HER_RESPONSIBILITIES",
    order: 2,
    label: "Qué hace ella",
    objective:
      "Explicar su parte: crear contenido, subirlo a Drive, seguir referencias/guiones, comunicar sus límites y responder en plazo.",
    knowledgeRefs: ["content-model-responsibilities"]
  },
  {
    id: "CONTENT_AND_FACE",
    order: 3,
    label: "Contenido",
    objective:
      "Volumen inicial (~5 días, 2-3 fotos/día) y recurrente (Reels), contenido nuevo para Instagram y reutilizable en OnlyFans. La cara y la privacidad NO se mencionan proactivamente (decisión de Alex jun-2026): solo se responden si la candidata pregunta (el conocimiento las cubre de forma reactiva).",
    knowledgeRefs: ["content-production-volume", "content-new-and-old-material"]
  },
  {
    id: "MONEY",
    order: 4,
    label: "Reparto y cobro",
    objective:
      "Presentar el reparto 70/30 FRESCO en la llamada (sin dar por hecho que ya se dijo por Instagram), liquidación cada 14 días (ella cobra primero), sin salario fijo y sin prometer cifras. La negociación a la baja la decide el código si se queja.",
    knowledgeRefs: [
      "commercial-revenue-share-general",
      "commercial-revenue-share-settlement",
      "commercial-no-fixed-salary",
      "commercial-why-agency-70"
    ]
  },
  {
    id: "BOUNDARIES",
    order: 5,
    label: "Límites y consentimiento",
    objective: "Preguntar con tacto si hay algún tipo de contenido que no quiera hacer y dejar claro que se respeta.",
    knowledgeRefs: ["content-boundaries-neutral-question"]
  },
  {
    id: "CLOSE",
    order: 6,
    label: "Cierre y siguiente paso",
    objective:
      "Si no le quedan dudas, cerrar cálido: 'ahora te paso el contrato, léelo con calma y cualquier duda sobre él me avisas'. NO cerrar compromiso firme.",
    knowledgeRefs: []
  }
] as const;

/** Devuelve la etapa por id. */
export function callAgendaStage(id: CallAgendaStageId): CallAgendaStage {
  const stage = CALL_AGENDA.find((s) => s.id === id);
  if (!stage) {
    throw new Error(`Etapa de agenda de llamada desconocida: ${id}`);
  }
  return stage;
}

/**
 * Dada la lista de etapas ya cubiertas, devuelve la siguiente etapa pendiente en orden, o null si ya
 * se cubrieron todas (toca cerrar).
 */
export function nextCallAgendaStage(covered: readonly CallAgendaStageId[]): CallAgendaStage | null {
  for (const stage of [...CALL_AGENDA].sort((a, b) => a.order - b.order)) {
    if (!covered.includes(stage.id)) {
      return stage;
    }
  }
  return null;
}
