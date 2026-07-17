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

export type CallAgendaStageId = "HOW_AGENCY_WORKS" | "HER_RESPONSIBILITIES" | "CONTENT_AND_FACE" | "MONEY" | "CLOSE";

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
    // services-secondary-traffic ELIMINADA (orden de Alex 6-jul): Telegram/Twitter/videollamadas/Drive
    // no se mencionan en ningun canal.
    knowledgeRefs: ["services-agency-management", "content-agency-responsibilities", "geo-privacy-three-layers"]
  },
  {
    id: "HER_RESPONSIBILITIES",
    order: 2,
    label: "Qué hace ella",
    // OJO: este objective LLEGA AL PROMPT del redactor. La nota "los límites NO se sacan proactivamente"
    // vivía aquí dentro y el modelo — ceguera a la negación — leía "límites" y LOS SACABA (1a llamada real
    // 17-jul: soltó la pregunta de límites en mitad de la aclaración de Drive). Las restricciones van en
    // comentarios (para humanos), nunca en el texto que ve el modelo. Límites: por WhatsApp (Alex 3-jul y
    // 17-jul); su ficha está además en la blocklist de la llamada.
    objective: "Explicar su parte, CORTA: crear el contenido, enviárnoslo y responder en plazo (un día o dos).",
    knowledgeRefs: ["content-model-responsibilities"]
  },
  {
    id: "CONTENT_AND_FACE",
    order: 3,
    label: "Contenido",
    // Misma regla que arriba: la nota "la cara NO se menciona proactivamente" (Alex jun-2026) se quita del
    // texto que ve el modelo (nombrarla para prohibirla es invitarla). La cara sigue cubierta REACTIVAMENTE
    // por el conocimiento si ella pregunta.
    objective:
      "Volumen inicial (~5 días, 2-3 fotos/día) y recurrente (Reels), contenido nuevo para Instagram y reutilizable en OnlyFans.",
    knowledgeRefs: ["content-production-volume", "content-new-and-old-material"]
  },
  {
    id: "MONEY",
    order: 4,
    label: "Reparto y cobro",
    objective:
      "Presentar el reparto 70/30 FRESCO en la llamada (sin dar por hecho que ya se dijo por Instagram), cobro cada 14 días (ella cobra primero; di 'cobras', nunca 'se liquida'), sin salario fijo y sin prometer cifras. La negociación a la baja la decide el código si se queja.",
    knowledgeRefs: [
      "commercial-revenue-share-general",
      "commercial-revenue-share-settlement",
      "commercial-no-fixed-salary",
      "commercial-why-agency-70"
    ]
  },
  // BOUNDARIES eliminada de la agenda PROACTIVA (decisión de Alex 3-jul): la pregunta de límites en frío
  // alargaba la llamada y quedaba rara; el cierre remite a WhatsApp ("si hay algo que no quieras hacer,
  // me lo dices") y el conocimiento de límites SIGUE activo de forma REACTIVA (si ella lo saca, el bot
  // sabe explicarlo y registrarlo).
  {
    id: "CLOSE",
    order: 5,
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
