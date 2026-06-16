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
}

const DEFER_TEXT =
  "Mira, ese punto prefiero confirmarlo con mi socio y te digo, que no quiero decirte nada que no sea exacto, ¿vale?";
const HANDOFF_TEXT =
  "Te entiendo. Mira, para esto lo mejor es que lo veas directamente con Alex; ahora mismo le digo que se ponga en contacto contigo, ¿vale?";
const CLOSE_TEXT =
  "Perfecto. Pues te paso ahora el contrato para que lo leas con calma; cualquier duda que tengas sobre él, me dices sin problema, ¿vale?";

/** Convierte una directiva del director en un plan de enunciado. */
export function planCallUtterance(input: PlanCallUtteranceInput): CallUtterancePlan {
  const { directive } = input;

  switch (directive.type) {
    case "GIVE_DISCLOSURE": {
      const text = callOpeningDisclosure({ candidateName: input.candidateName, recorded: input.recorded });
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "DEFER_TO_PARTNER":
      return { directiveType: directive.type, deterministicText: DEFER_TEXT, fallbackText: DEFER_TEXT };
    case "HANDOFF_TO_ALEX":
      return { directiveType: directive.type, deterministicText: HANDOFF_TEXT, fallbackText: HANDOFF_TEXT };
    case "CLOSE_WITH_CONTRACT":
      return { directiveType: directive.type, deterministicText: CLOSE_TEXT, fallbackText: CLOSE_TEXT };
    case "CONCEDE_SHARE": {
      const text = concedeShareText(directive.shareOffer);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "ANSWER_FROM_KNOWLEDGE":
      return planFromKnowledge(directive.type, input.knowledge, {
        instruction: "Responde a su pregunta de forma directa, breve y cercana, apoyándote solo en estos hechos.",
        referenceInstagram: false,
        emptyFallback: DEFER_TEXT
      });
    case "REASSURE":
      return planFromKnowledge(directive.type, input.knowledge, {
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
  const stageId = input.directive.stageId ?? "RAPPORT";
  const stage = callAgendaStage(stageId);
  const gathered = gatherKnowledge(input.knowledge);
  const referenceInstagram = stageId === "MONEY";

  const brief: CallDraftingBrief = {
    instruction: stage.objective,
    groundingFacts: gathered.points,
    prohibitedClaims: gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram
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
  opts: { instruction: string; referenceInstagram: boolean; emptyFallback: string }
): CallUtterancePlan {
  const gathered = gatherKnowledge(knowledge);
  const brief: CallDraftingBrief = {
    instruction: opts.instruction,
    groundingFacts: gathered.points,
    prohibitedClaims: gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram: opts.referenceInstagram
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
    if (shareOffer) {
      // Cifra exacta de la oferta autorizada + "%" (los TTS lo leen "por ciento"). No se concatenan puntos
      // genéricos del conocimiento detrás (sonaría contradictorio tras dar la cifra exacta).
      return `Como te dije por Instagram, trabajamos con un ${shareOffer.modelShare}% para ti y un ${shareOffer.agencyShare}% para nosotros.`;
    }
    return points[0] ?? "Como te comenté por Instagram, el reparto es el que ya hablamos.";
  }

  // Etapas de puro guion (sin afirmaciones de negocio): pegamento conversacional.
  const scripted: Partial<Record<CallAgendaStageId, string>> = {
    RAPPORT: "¡Hola! Soy de Rose Models, hablamos por Instagram. ¿Qué tal, te pillo bien?",
    FRAME:
      "Te llamo porque vimos tu perfil y encajas; así te cuento bien cómo trabajamos y resolvemos cualquier duda que tengas.",
    BOUNDARIES: "Y dime una cosa: ¿hay algún tipo de contenido que no quieras hacer? Lo respetamos sin problema."
  };

  // Para etapas con conocimiento (cómo trabaja la agencia, su parte, contenido), el fallback son los
  // puntos aprobados; si no hay (etapas de guion), el pegamento; si nada (no debería: las refs son ACTIVE),
  // se defiere a Alex en vez de soltar un puente vacío que suena a dar largas.
  return (
    points.slice(0, 2).join(" ") ||
    scripted[stageId] ||
    "Ese detalle prefiero que te lo confirme bien mi socio, para no decirte nada inexacto."
  );
}
