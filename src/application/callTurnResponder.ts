/**
 * Responde un turno de la llamada a partir del historial de mensajes estilo OpenAI (lo que envía el
 * "Custom LLM" de la plataforma de voz en cada turno).
 *
 * Es STATELESS: reconstruye el estado del director RE-REPRODUCIENDO los turnos de la candidata (la
 * clasificación es determinista y las señales que NO cambian estado —preguntas, desconfianza— no
 * afectan a la reproducción), así no necesita almacén entre invocaciones (ideal en serverless).
 *
 * Redacción: v1 DETERMINISTA (texto fijo o fallback del plan). Las preguntas CUBIERTAS por el conocimiento
 * aprobado se responden (decisión de Alex 17-jun); las NO cubiertas se defieren a Alex ("mi socio"). El
 * recuperador solo se consulta para el ÚLTIMO turno (el del directivo en vivo): el replay no lo necesita
 * porque asks-covered/asks-unknown no cambian el estado del director.
 */

import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { runCallTurn, type CallTurnResult } from "./callBrain";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "./callDirector";
import { classifyCallSignal } from "./callSignalClassifier";
import { LocalBusinessKnowledgeRetriever, type BusinessKnowledgeRetriever } from "./businessKnowledgeRetriever";

export interface CallChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RespondToCallInput {
  messages: CallChatMessage[];
  candidateName?: string;
  recorded?: boolean;
  /** Recuperador de conocimiento (inyectable para tests); por defecto el local sobre el contenido. */
  retriever?: BusinessKnowledgeRetriever;
  /** Si false, NO responde preguntas con el conocimiento (las defiere todas). Por defecto true. */
  answerFromKnowledge?: boolean;
}

export interface CallResponderResult {
  /** Lo que debe decir el bot en este turno. */
  content: string;
  signal: CallTurnResult["signal"];
  directiveType: CallTurnResult["directive"]["type"];
}

// Candidata sintética para consultar el conocimiento durante la llamada (estado de llamada en curso).
// La recuperación usa `ignoreStateGating` (la candidata ya está cualificada): se responde cualquier hecho
// aprobado y NO sensible; el % y los DRAFT siguen sin salir por aquí.
const callKnowledgeCandidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "call_context" }),
  currentState: "CALL_IN_PROGRESS"
});

const defaultRetriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);

export async function respondToCall(input: RespondToCallInput): Promise<CallResponderResult> {
  const userUtterances = input.messages.filter((m) => m.role === "user").map((m) => m.content ?? "");

  // La apertura legal se considera dada SOLO si el BOT ya habló (mensaje assistant no vacío). NO se infiere
  // de que la candidata haya hablado: si ella habla primero, el bot debe abrir igualmente con la locución
  // legal (no perderla nunca; riesgo EU AI Act / RGPD).
  const botHasSpoken = input.messages.some((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0);

  // Interruptor de la apertura legal. Por defecto ACTIVA (es obligatoria por ley antes de una llamada
  // real). CALL_DISCLOSURE=off la desactiva SOLO para pruebas; debe volver a ON antes de producción.
  const disclosureEnabled = process.env.CALL_DISCLOSURE !== "off";

  let state: CallDirectorState = initialCallDirectorState();
  if (!disclosureEnabled) {
    state = { ...state, disclosureGiven: true };
  }
  let lastUtterance = "";

  if (botHasSpoken) {
    // Consume el primer turno del bot (la apertura legal si está activa, o la 1ª etapa si no) y reproduce
    // los turnos previos de la candidata para reconstruir el estado. La señal "none" produce lo correcto
    // en ambos casos (apertura si disclosureGiven=false; avanzar agenda si ya está dada).
    state = decideCallDirective({ state, signal: "none" }).nextState;
    for (let i = 0; i < userUtterances.length - 1; i++) {
      const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
      const signal = classifyCallSignal({ utterance: userUtterances[i], moneyContext });
      state = decideCallDirective({ state, signal }).nextState;
    }
    lastUtterance = userUtterances[userUtterances.length - 1] ?? "";
  }

  // Conocimiento que cubre la pregunta del turno EN VIVO (solo si responder está activo y hay texto).
  const coveringEntries =
    input.answerFromKnowledge !== false && lastUtterance.trim().length > 0
      ? await resolveCoveringEntries(lastUtterance, input.retriever ?? defaultRetriever)
      : [];

  const result = runCallTurn({
    state,
    utterance: lastUtterance,
    candidateName: input.candidateName,
    recorded: input.recorded,
    // En el turno de apertura (el bot aún no habló) el bot INICIA: señal "none" (no "unclear" por vacío).
    signal: botHasSpoken ? undefined : "none",
    resolveQuestion: () => coveringEntries
  });

  // v1 determinista: texto fijo si lo hay, si no el fallback del plan (siempre presente, invariante 6).
  const content = result.utterancePlan.deterministicText ?? result.utterancePlan.fallbackText;
  return { content, signal: result.signal, directiveType: result.directive.type };
}

/** Entradas de conocimiento aprobado que cubren la pregunta (vacío si ninguna -> se defiere a Alex). */
async function resolveCoveringEntries(question: string, retriever: BusinessKnowledgeRetriever): Promise<KnowledgeEntry[]> {
  return retriever.retrieve({
    candidate: callKnowledgeCandidate,
    intent: "REQUESTS_INFORMATION",
    question,
    limit: 3,
    ignoreStateGating: true
  });
}
