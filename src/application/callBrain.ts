/**
 * Cerebro de la llamada (un turno): une las piezas deterministas en el flujo que ejecutará el endpoint
 * de voz en cada turno:
 *
 *   texto de la candidata  ->  [oído] clasifica señal  ->  [director] decide directiva  ->
 *   [boca] planifica el enunciado (determinista o brief+fallback)  ->  resultado + estado siguiente
 *
 * NO hace I/O ni llama al LLM: la redacción final (a partir del `draftingBrief`) y el habla la hace el
 * adaptador/endpoint con `openaiProvider` + fallback. El conocimiento de las etapas se resuelve por sus
 * referencias (síncrono); la cobertura de una PREGUNTA la inyecta el endpoint vía `resolveQuestion`
 * (usando el recuperador real). Sin resolver, las preguntas se defieren a Alex (nunca se improvisa).
 *
 * Invariante 1: todo el flujo lo decide el código; el LLM solo redacta después, dentro del brief.
 */

import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { CALL_AGENDA, callAgendaStage, type CallAgendaStageId } from "./callAgenda";
import type { CallContext } from "./callContext";
import { decideCallDirective, type CallCandidateSignal, type CallDirective, type CallDirectorState } from "./callDirector";
import { classifyCallSignal } from "./callSignalClassifier";
import { planCallUtterance, type CallUtterancePlan } from "./callRedaction";

const DISTRUST_KNOWLEDGE_ID = "objection-distrust";

export interface CallTurnResult {
  signal: CallCandidateSignal;
  directive: CallDirective;
  utterancePlan: CallUtterancePlan;
  nextState: CallDirectorState;
}

export interface RunCallTurnInput {
  state: CallDirectorState;
  /** Lo último que dijo la candidata (texto de STT). Vacío en el turno de apertura. */
  utterance: string;
  candidateName?: string;
  recorded?: boolean;
  /**
   * Devuelve las entradas de conocimiento que CUBREN la pregunta (vacío si ninguna). Lo inyecta el
   * endpoint con el recuperador real; sin él, las preguntas se defieren a Alex.
   */
  resolveQuestion?: (question: string) => KnowledgeEntry[];
  /** Señal explícita (salta la clasificación). La usa la apertura del turno inicial ("none"). */
  signal?: CallCandidateSignal;
  /** Contexto de la candidata (del DM): nombre, dudas previas, resumen. Personaliza la redacción. */
  context?: CallContext;
  /** Hechos que ella YA dijo en esta llamada (extraídos determinista por el responder): no re-preguntar. */
  callFacts?: string[];
  /**
   * Veces que cada directiva YA se dio en esta llamada (lo calcula el replay del responder). Anti-bucle:
   * selecciona variantes deterministas y avisa al redactor para que no repita la misma formulación.
   */
  directiveRepeats?: Partial<Record<CallDirective["type"], number>>;
  /** Lo último que DIJO EL BOT (del transcript): para repetirlo si ella no lo oyó ("¿qué decías?"). */
  lastBotUtterance?: string;
}

/** Ejecuta un turno del cerebro de la llamada. */
export function runCallTurn(input: RunCallTurnInput): CallTurnResult {
  const coveringEntries = input.resolveQuestion?.(input.utterance) ?? [];
  // En contexto de dinero (ya se presentó el reparto o se está negociando) una queja "suelta" cuenta.
  const moneyContext = input.state.coveredStages.includes("MONEY") || input.state.revenueShareStep > 0;
  const signal =
    input.signal ??
    classifyCallSignal({
      utterance: input.utterance,
      isCoveredQuestion: coveringEntries.length > 0,
      moneyContext
    });
  const { directive, nextState } = decideCallDirective({ state: input.state, signal });
  const knowledge = knowledgeForDirective(directive, coveringEntries);
  const utterancePlan = planCallUtterance({
    directive,
    candidateName: input.candidateName ?? input.context?.candidateName,
    recorded: input.recorded,
    knowledge,
    context: input.context,
    // Brief conversacional (jul-2026): lo que acaba de decir + dónde va la llamada + lo que ya contó.
    // Solo INFORMA al redactor (naturalidad); el orden/flujo lo sigue decidiendo el director.
    utterance: input.utterance,
    coveredTopics: topicLabels(input.state.coveredStages),
    pendingTopics: topicLabels(CALL_AGENDA.map((s) => s.id).filter((id) => !nextState.coveredStages.includes(id))),
    callFacts: input.callFacts,
    repetitionIndex: input.directiveRepeats?.[directive.type] ?? 0,
    lastBotUtterance: input.lastBotUtterance
  });
  return { signal, directive, utterancePlan, nextState };
}

/** Etiquetas en español de etapas de agenda (sin el cierre: no es un "tema" que anunciar). */
function topicLabels(stages: readonly CallAgendaStageId[]): string[] {
  return stages.filter((id) => id !== "CLOSE").map((id) => callAgendaStage(id).label);
}

function knowledgeForDirective(directive: CallDirective, coveringEntries: KnowledgeEntry[]): KnowledgeEntry[] | undefined {
  switch (directive.type) {
    case "COVER_STAGE":
      return directive.stageId ? knowledgeByIds(callAgendaStage(directive.stageId).knowledgeRefs) : undefined;
    case "ANSWER_FROM_KNOWLEDGE":
      return coveringEntries;
    case "REASSURE":
      return knowledgeByIds([DISTRUST_KNOWLEDGE_ID]);
    default:
      return undefined;
  }
}

/** Busca entradas por id, SOLO activas y aprobadas (no se vocea contenido DRAFT en una llamada en vivo). */
function knowledgeByIds(ids: readonly string[]): KnowledgeEntry[] {
  if (ids.length === 0) return [];
  const idSet = new Set(ids);
  return businessKnowledgeEntries.filter((entry) => idSet.has(entry.id) && entry.status === "ACTIVE" && entry.approvedByAlex);
}
