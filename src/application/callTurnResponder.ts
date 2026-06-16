/**
 * Responde un turno de la llamada a partir del historial de mensajes estilo OpenAI (lo que envía el
 * "Custom LLM" de la plataforma de voz en cada turno).
 *
 * Es STATELESS: reconstruye el estado del director RE-REPRODUCIENDO los turnos de la candidata (la
 * clasificación es determinista y las señales que NO cambian estado —preguntas, desconfianza— no
 * afectan a la reproducción), así no necesita almacén entre invocaciones (ideal en serverless).
 *
 * v1: la redacción es DETERMINISTA (texto fijo o fallback del plan). La redacción natural por LLM se
 * añade enchufando un `CallUtteranceDrafter` (ver endpoint); por defecto, las PREGUNTAS se DEFIEREN a
 * Alex ("se lo comento a mi socio"), que es justo el comportamiento seguro que pidió Alex.
 */

import { runCallTurn, type CallTurnResult } from "./callBrain";
import { decideCallDirective, initialCallDirectorState, type CallDirectorState } from "./callDirector";
import { classifyCallSignal } from "./callSignalClassifier";

export interface CallChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RespondToCallInput {
  messages: CallChatMessage[];
  candidateName?: string;
  recorded?: boolean;
}

export interface CallResponderResult {
  /** Lo que debe decir el bot en este turno. */
  content: string;
  signal: CallTurnResult["signal"];
  directiveType: CallTurnResult["directive"]["type"];
}

export function respondToCall(input: RespondToCallInput): CallResponderResult {
  const userUtterances = input.messages.filter((m) => m.role === "user").map((m) => m.content ?? "");

  // La apertura legal se considera dada SOLO si el BOT ya habló (mensaje assistant no vacío). NO se infiere
  // de que la candidata haya hablado: si ella habla primero, el bot debe abrir igualmente con la locución
  // legal (no perderla nunca; riesgo EU AI Act / RGPD).
  const botHasSpoken = input.messages.some((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0);

  let state: CallDirectorState = initialCallDirectorState();
  let lastUtterance = "";

  if (botHasSpoken) {
    // Consume la apertura (ya dicha) y reproduce los turnos previos de la candidata para reconstruir el
    // estado actual del director. Cada turno se clasifica con el mismo contexto de dinero que el turno vivo.
    state = decideCallDirective({ state, signal: "none" }).nextState;
    for (let i = 0; i < userUtterances.length - 1; i++) {
      const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
      const signal = classifyCallSignal({ utterance: userUtterances[i], moneyContext });
      state = decideCallDirective({ state, signal }).nextState;
    }
    lastUtterance = userUtterances[userUtterances.length - 1] ?? "";
  }

  const result = runCallTurn({
    state,
    utterance: lastUtterance,
    candidateName: input.candidateName,
    recorded: input.recorded
  });

  // v1 determinista: texto fijo si lo hay, si no el fallback del plan (siempre presente, invariante 6).
  const content = result.utterancePlan.deterministicText ?? result.utterancePlan.fallbackText;
  return { content, signal: result.signal, directiveType: result.directive.type };
}
