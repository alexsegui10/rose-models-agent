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

  let state: CallDirectorState = initialCallDirectorState();
  let lastUtterance = "";

  if (userUtterances.length > 0) {
    // La apertura legal ya se dijo (fue el primer turno del bot): consúmela y reproduce los turnos
    // previos de la candidata para reconstruir el estado actual del director.
    state = decideCallDirective({ state, signal: "none" }).nextState;
    for (let i = 0; i < userUtterances.length - 1; i++) {
      const signal = classifyCallSignal({ utterance: userUtterances[i] });
      state = decideCallDirective({ state, signal }).nextState;
    }
    lastUtterance = userUtterances[userUtterances.length - 1];
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
