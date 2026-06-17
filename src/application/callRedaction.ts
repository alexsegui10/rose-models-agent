/**
 * "Boca" del bot de llamada: convierte una directiva del director en QUÉ se dice. NO llama al LLM aquí
 * (eso es del adaptador/endpoint); produce un PLAN de enunciado:
 *  - `deterministicText`: para lo crítico/seguro (apertura legal, deferir, handoff, cierre, la CIFRA del
 *    reparto) se dice tal cual, sin LLM.
 *  - `draftingBrief`: para lo explicativo (etapas, responder, tranquilizar) se da una instrucción + los
 *    hechos APROBADOS del conocimiento en los que apoyarse, para que el LLM lo redacte natural.
 *  - `fallbackText`: SIEMPRE presente (invariante 6): si el LLM falla o no aplica, esto se dice. Las
 *    afirmaciones de negocio del fallback salen del conocimiento aprobado o de la cifra autorizada del
 *    reparto; solo el "pegamento" conversacional (saludo, encuadre, pregunta de límites) es guion.
 *
 * Invariante 1: el plan lo determina el código a partir de la directiva; el LLM solo redacta dentro de
 * los hechos del brief. Invariante 3: la cifra del reparto viene de la directiva (callNegotiation), nunca
 * del LLM.
 */

import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { callAgendaStage, type CallAgendaStageId } from "./callAgenda";
import type { CallContext } from "./callContext";
import { callOpeningDisclosure } from "./callDisclosure";
import type { CallDirective } from "./callDirector";
import type { CallRevenueShareOffer } from "./callNegotiation";

export interface CallDraftingBrief {
  /** Qué tiene que comunicar el bot este turno. */
  instruction: string;
  /** Hechos APROBADOS en los que apoyarse (el LLM no inventa fuera de aquí). */
  groundingFacts: string[];
  /** Lo que NO puede decir (de prohibitedClaims del conocimiento). */
  prohibitedClaims: string[];
  /** Matices obligatorios (mandatoryNuances). */
  mandatoryNuances: string[];
  /** Si conviene referenciar el DM ("como te dije por Instagram"), para que se note que es la misma persona. */
  referenceInstagram: boolean;
  /** Contexto de la candidata (nombre, dudas previas, resumen del DM) para personalizar la redacción. */
  context?: CallContext;
}

export interface CallUtterancePlan {
  directiveType: CallDirective["type"];
  /** Texto determinista listo para decir. Si está, se usa tal cual (sin LLM). */
  deterministicText?: string;
  /** Brief para redactar con LLM (cuando no es determinista). */
  draftingBrief?: CallDraftingBrief;
  /** Respaldo determinista SIEMPRE presente (invariante 6). */
  fallbackText: string;
}

export interface PlanCallUtteranceInput {
  directive: CallDirective;
  candidateName?: string;
  recorded?: boolean;
  /** Conocimiento de apoyo: de la etapa (COVER_STAGE) o recuperado por la pregunta (ANSWER/REASSURE). */
  knowledge?: KnowledgeEntry[];
  /** Contexto de la candidata (del DM). Se adjunta al brief y aporta el nombre si no se pasó aparte. */
  context?: CallContext;
}

const DEFER_TEXT =
  "Mira, ese punto prefiero confirmarlo con mi socio y te digo, que no quiero decirte nada que no sea exacto, ¿vale?";
const HANDOFF_TEXT =
  "Te entiendo. Mira, para esto lo mejor es que lo veas directamente con mi socio; ahora mismo le digo que se ponga en contacto contigo, ¿vale?";
const CLOSE_TEXT =
  "Pues con esto te haces una idea. Te paso ahora el contrato para que lo leas con calma y cualquier duda que tengas me la dices, ¿vale?";

/**
 * Guion propio de la LLAMADA por etapa (lo que dice el bot, en la voz de Alex). Es texto pensado para
 * hablar (no los snippets cortos del chat). El conocimiento sigue alimentando el brief del LLM y los
 * hechos; estas son las líneas deterministas de la llamada. MONEY se construye con la cifra autorizada.
 */
const CALL_SCRIPT: Partial<Record<CallAgendaStageId, string>> = {
  HOW_AGENCY_WORKS:
    "Genial. Mira, te resumo cómo trabajamos: tú solo te encargas de mandarnos el contenido y nosotros hacemos todo lo demás. El tráfico lo generamos con cuentas de Instagram con nombres y ubicaciones de España, y cuando ya tienen bastantes seguidores ponemos el link a tu OnlyFans y un equipo de chatters lo monetiza las 24 horas.",
  HER_RESPONSIBILITIES:
    "Por tu parte es sencillo: creas el contenido, lo subes a una carpeta de Drive que compartimos, sigues unas referencias que te pasamos y nos dices siempre tus límites. Con responder en un día o dos, de sobra.",
  CONTENT_AND_FACE:
    "Al principio son unos cinco días suaves, 2 o 3 fotos al día, y luego vamos a vídeos cada semana. Te adelanto algo importante: la cara se enseña, eso es imprescindible, pero cuidamos mucho tu privacidad, todo va con identidad española.",
  BOUNDARIES:
    "Una cosa que siempre pregunto: ¿hay algún tipo de contenido que no quieras hacer o algún límite que deba tener en cuenta? Lo respetamos sin problema."
};
// Cierre cálido sin contrato (no le interesa): no se presiona, puerta abierta.
const CLOSE_SOFT_TEXT =
  "Te entiendo perfectamente, sin ningún problema. Lo dejamos aquí entonces; si en algún momento te animas, aquí nos tienes, ¿vale? Gracias por tu tiempo y un saludo.";
// Defensa del 70 una vez antes de bajar (el porqué del reparto; el modelo de la agencia ya documentado).
const DEFEND_SHARE_TEXT =
  "Te entiendo. Mira, ese 70 es para ti, que es de lo mejor que vas a encontrar; y a cambio nosotros llevamos todo el tráfico, el equipo de chatters y toda la gestión, tú solo subes el contenido. De verdad que te sale muy a cuenta, ¿lo ves?";
// No se entendió bien lo que dijo (ruido/STT): pedir que lo repita, sin asumir asentimiento.
const ASK_REPEAT_TEXT = "Perdona, no te he pillado bien con la línea. ¿Me lo puedes repetir?";

/** Convierte una directiva del director en un plan de enunciado. */
export function planCallUtterance(input: PlanCallUtteranceInput): CallUtterancePlan {
  const { directive } = input;

  switch (directive.type) {
    case "GIVE_DISCLOSURE": {
      const candidateName = input.candidateName ?? input.context?.candidateName;
      const text = callOpeningDisclosure({ candidateName, recorded: input.recorded });
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "DEFER_TO_PARTNER":
      return { directiveType: directive.type, deterministicText: DEFER_TEXT, fallbackText: DEFER_TEXT };
    case "HANDOFF_TO_ALEX":
      return { directiveType: directive.type, deterministicText: HANDOFF_TEXT, fallbackText: HANDOFF_TEXT };
    case "CLOSE_WITH_CONTRACT":
      return { directiveType: directive.type, deterministicText: CLOSE_TEXT, fallbackText: CLOSE_TEXT };
    case "CLOSE_SOFT":
      return { directiveType: directive.type, deterministicText: CLOSE_SOFT_TEXT, fallbackText: CLOSE_SOFT_TEXT };
    case "DEFEND_SHARE":
      return { directiveType: directive.type, deterministicText: DEFEND_SHARE_TEXT, fallbackText: DEFEND_SHARE_TEXT };
    case "ASK_REPEAT":
      return { directiveType: directive.type, deterministicText: ASK_REPEAT_TEXT, fallbackText: ASK_REPEAT_TEXT };
    case "CONCEDE_SHARE": {
      const text = concedeShareText(directive.shareOffer);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "ANSWER_FROM_KNOWLEDGE":
      return planFromKnowledge(directive.type, input.knowledge, input.context, {
        instruction: "Responde a su pregunta de forma directa, breve y cercana, apoyándote solo en estos hechos.",
        referenceInstagram: false,
        emptyFallback: DEFER_TEXT
      });
    case "REASSURE":
      return planFromKnowledge(directive.type, input.knowledge, input.context, {
        instruction: "Tranquiliza su desconfianza con cercanía y naturalidad, sin presionar, y retoma la conversación.",
        referenceInstagram: false,
        emptyFallback:
          "Te entiendo, es normal tener dudas. Somos una agencia con gente real detrás y vamos paso a paso contigo, sin prisa. ¿Qué es lo que más te preocupa?"
      });
    case "COVER_STAGE":
    default:
      return planCoverStage(input);
  }
}

function concedeShareText(offer?: CallRevenueShareOffer): string {
  if (!offer) {
    // No debería ocurrir; ante la duda, deferimos en vez de inventar una cifra.
    return DEFER_TEXT;
  }
  const base = `Te entiendo. Mira, por ti lo podemos dejar en un ${offer.modelShare}% para ti y un ${offer.agencyShare}% para nosotros`;
  return offer.isFloor ? `${base}, y de ahí ya no podemos bajar más, ¿vale?` : `${base}, ¿qué te parece?`;
}

function planCoverStage(input: PlanCallUtteranceInput): CallUtterancePlan {
  const stageId = input.directive.stageId ?? "HOW_AGENCY_WORKS";
  const stage = callAgendaStage(stageId);
  const gathered = gatherKnowledge(input.knowledge);
  const referenceInstagram = stageId === "MONEY";

  const brief: CallDraftingBrief = {
    instruction: stage.objective,
    groundingFacts: gathered.points,
    prohibitedClaims: gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram,
    context: input.context
  };

  return {
    directiveType: "COVER_STAGE",
    draftingBrief: brief,
    fallbackText: stageFallbackText(stageId, gathered.points, input.directive.shareOffer)
  };
}

function planFromKnowledge(
  directiveType: CallDirective["type"],
  knowledge: KnowledgeEntry[] | undefined,
  context: CallContext | undefined,
  opts: { instruction: string; referenceInstagram: boolean; emptyFallback: string }
): CallUtterancePlan {
  const gathered = gatherKnowledge(knowledge);
  const brief: CallDraftingBrief = {
    instruction: opts.instruction,
    groundingFacts: gathered.points,
    prohibitedClaims: gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram: opts.referenceInstagram,
    context
  };
  const fallbackText = gathered.points.length > 0 ? gathered.points.slice(0, 2).join(" ") : opts.emptyFallback;
  return { directiveType, draftingBrief: brief, fallbackText };
}

function gatherKnowledge(entries: KnowledgeEntry[] = []): {
  points: string[];
  prohibited: string[];
  nuances: string[];
} {
  const points: string[] = [];
  const prohibited: string[] = [];
  const nuances: string[] = [];
  for (const entry of entries) {
    points.push(...entry.approvedAnswerPoints);
    prohibited.push(...entry.prohibitedClaims);
    nuances.push(...entry.mandatoryNuances);
  }
  return { points: dedupe(points), prohibited: dedupe(prohibited), nuances: dedupe(nuances) };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

/**
 * Fallback determinista por etapa. Las afirmaciones de negocio salen del conocimiento aprobado (`points`);
 * solo el pegamento conversacional (saludo, encuadre, pregunta de límites) es guion fijo. En MONEY, la
 * cifra sale de la oferta autorizada (callNegotiation), no de texto libre.
 */
function stageFallbackText(stageId: CallAgendaStageId, points: string[], shareOffer?: CallRevenueShareOffer): string {
  if (stageId === "MONEY") {
    // Cifra exacta de la oferta autorizada + "%" (los TTS lo leen "por ciento"); referencia el DM.
    if (shareOffer) {
      return `Y del dinero, como ya te dije por Instagram, es un ${shareOffer.modelShare}% para ti y un ${shareOffer.agencyShare}% para nosotros; se liquida cada 14 días y cobras tú primero.`;
    }
    return points[0] ?? "Como te comenté por Instagram, el reparto es el que ya hablamos.";
  }

  // Guion propio de la llamada (la voz de Alex). Si una etapa no lo tiene, cae a los puntos aprobados del
  // conocimiento y, en último caso, a deferir (nunca un puente vacío que suene a dar largas).
  return (
    CALL_SCRIPT[stageId] ||
    points.slice(0, 2).join(" ") ||
    "Ese detalle prefiero que te lo confirme bien mi socio, para no decirte nada inexacto."
  );
}
