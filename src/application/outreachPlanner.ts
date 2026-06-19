import type { Candidate, CandidateState, ConversationMessage } from "@/domain/candidate";
import { isStopRequest } from "@/domain/stopRequest";

/**
 * RE-ENGANCHE proactivo + REAGENDAR (decisiones puras, sin I/O). Decide si conviene escribirle a una
 * candidata que dejo de contestar — o reabrir el agendado tras 3 llamadas sin respuesta — y QUE escribir.
 * NO envia nada ni toca la BD: el endpoint cron orquesta el envio y la persistencia con lo que devuelve.
 *
 * Decisiones de Alex que esta logica codifica (no cambiar):
 *  - Maximo 2 toques de re-enganche; despues se deja en FRIO (sin cerrar a malas).
 *  - Ventana de Instagram: solo se puede escribir con mensajeria estandar DENTRO de las 24h del ultimo
 *    mensaje de la candidata; pasadas 24h hay que usar la etiqueta human_agent. Por eso `humanAgentTag`
 *    se decide por el tiempo de inactividad (idle > 24h).
 *  - Tras 3 llamadas sin respuesta (CALL_NO_ANSWER + callAttempts>=3) -> reagendar por IG.
 *
 * Los toques previos se cuentan por TRIGGER de mensaje del agente (sin columna nueva en BD).
 */

export type OutreachKind = "reengage" | "reschedule";

export interface OutreachPlan {
  kind: OutreachKind;
  message: string;
  /** true si hay que enviar con la etiqueta human_agent (fuera de la ventana estandar de 24h). */
  humanAgentTag: boolean;
  /** Transicion de estado a aplicar tras enviar (solo en reschedule). */
  transitionTo?: CandidateState;
  /** true si este toque deja a la candidata en FRIO (toque 2 final del re-enganche). */
  markCold?: boolean;
}

export interface PlanOutreachInput {
  candidate: Candidate;
  /** Mensajes recientes de la conversacion (cualquier orden de llegada; se ordenan por fecha aqui). */
  recentMessages: ConversationMessage[];
  now: Date;
}

const HOUR_MS = 60 * 60 * 1000;
// Ventana estandar de Instagram: pasadas 24h del ultimo mensaje de la candidata hay que etiquetar.
const STANDARD_WINDOW_MS = 24 * HOUR_MS;
// Inactividad minima antes del PRIMER toque (~20h): un dia, sin esperar a las 24h exactas.
const IDLE_BEFORE_FIRST_TOUCH_MS = 20 * HOUR_MS;
// Espera minima entre el toque 1 y el toque 2 final (~24h): no spamear el mismo dia.
const IDLE_BEFORE_SECOND_TOUCH_MS = 24 * HOUR_MS;
const MIN_CALL_ATTEMPTS_FOR_RESCHEDULE = 3;
const MAX_REENGAGE_TOUCHES = 2;

// Marcadores en el campo `trigger` de los mensajes del agente. El cron persiste los mensajes proactivos
// con estos triggers, y aqui se cuentan para no repetir (sin columna nueva en BD).
export const REENGAGE_TRIGGER = "REENGAGE";
export const RESCHEDULE_TRIGGER = "RESCHEDULE_CALL";

// Estados del funnel ACTIVO en los que tiene sentido re-enganchar (la candidata aun no agendo ni se
// cerro/aprobo). NO incluye estados de revision humana, aprobado, ni la fase de llamada agendada.
const REENGAGE_STATES: ReadonlySet<CandidateState> = new Set([
  "NEW_LEAD",
  "QUALIFYING",
  "WAITING_PROFILE_ACCESS",
  "PROFILE_READY_FOR_REVIEW",
  "COLLECTING_CALL_DETAILS"
]);

const TERMINAL_STATES: ReadonlySet<CandidateState> = new Set(["CLOSED", "REJECTED"]);

// Mensajes variados (el cron elige uno de forma estable por candidata). El nombre va MUY de vez en
// cuando: la mayoria de variantes NO lo llevan. Sin cifras ni claims de negocio.
const FIRST_TOUCH_MESSAGES: ReadonlyArray<(name: string) => string> = [
  () => "Holaa, sigues interesada? Cualquier duda me dices sin problema",
  () => "Hey! sigues por aqui? si tienes cualquier duda me cuentas",
  (name) => `Holaa${name}, sigues interesada? sin compromiso, cualquier cosa me dices`,
  () => "Buenas! te quedo alguna duda? aqui estoy para lo que necesites"
];

const FINAL_TOUCH_MESSAGES: ReadonlyArray<(name: string) => string> = [
  () => "Te escribo por ultima vez por si te interesa, sin prisa. Si quieres seguir aqui estoy",
  () => "Lo dejo aqui por si acaso, sin agobiar. Si te apetece retomarlo me dices cuando quieras",
  (name) => `Ultimo mensaje${name}, sin prisa ninguna. Si te interesa seguir, aqui me tienes`
];

const RESCHEDULE_MESSAGES: ReadonlyArray<(name: string) => string> = [
  (name) => `Hola${name}, te intente llamar pero no pude localizarte 🙈. Que dia y hora te viene mejor para la llamada?`,
  () => "Hey! te intente llamar y no coincidimos 🙈. Cuando te viene bien que hablemos? me dices dia y hora",
  () => "Buenas! no consegui pillarte por telefono 🙈. Que momento te va mejor para la llamada?"
];

function nameSuffix(candidate: Candidate): string {
  const name = candidate.firstName?.trim();
  return name ? ` ${name}` : "";
}

// Eleccion ESTABLE de variante por candidata (mismo id -> misma plantilla), para que el mensaje no
// cambie entre ejecuciones del cron y para no depender de aleatoriedad (logica pura, testeable).
function pickStable(messages: ReadonlyArray<(name: string) => string>, candidate: Candidate, salt: number): string {
  let hash = salt >>> 0;
  for (const char of candidate.id) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return messages[hash % messages.length](nameSuffix(candidate));
}

function lastByCreatedAt(messages: ConversationMessage[]): ConversationMessage | undefined {
  let latest: ConversationMessage | undefined;
  for (const message of messages) {
    if (!latest || message.createdAt.getTime() > latest.createdAt.getTime()) {
      latest = message;
    }
  }
  return latest;
}

function countAgentTrigger(messages: ConversationMessage[], trigger: string): number {
  return messages.filter((message) => message.role === "agent" && message.metadata?.trigger === trigger).length;
}

function latestAgentTriggerAt(messages: ConversationMessage[], trigger: string): Date | undefined {
  let latest: Date | undefined;
  for (const message of messages) {
    if (message.role === "agent" && message.metadata?.trigger === trigger) {
      if (!latest || message.createdAt.getTime() > latest.getTime()) {
        latest = message.createdAt;
      }
    }
  }
  return latest;
}

export function planOutreach(input: PlanOutreachInput): OutreachPlan | null {
  const { candidate, recentMessages, now } = input;

  // --- Skips de seguridad (orden: lo mas barato/critico primero) ---
  if (TERMINAL_STATES.has(candidate.currentState)) return null;
  if (candidate.manualControlActive || candidate.automationPaused) return null;
  // Peticion explicita de no-contacto en CUALQUIER mensaje de la candidata: no se la vuelve a tocar.
  const candidateAskedToStop = recentMessages.some((message) => message.role === "candidate" && isStopRequest(message.content));
  if (candidateAskedToStop) return null;

  const lastMessageAtMs = candidate.lastMessageAt?.getTime();
  if (lastMessageAtMs === undefined) return null;
  const idleMs = now.getTime() - lastMessageAtMs;
  const outsideStandardWindow = idleMs > STANDARD_WINDOW_MS;

  // --- RESCHEDULE: 3 llamadas sin respuesta -> reabrir el agendado por IG ---
  if (candidate.currentState === "CALL_NO_ANSWER" && candidate.callAttempts >= MIN_CALL_ATTEMPTS_FOR_RESCHEDULE) {
    const alreadyRescheduled = countAgentTrigger(recentMessages, RESCHEDULE_TRIGGER) > 0;
    if (alreadyRescheduled) return null;
    return {
      kind: "reschedule",
      message: pickStable(RESCHEDULE_MESSAGES, candidate, 7),
      humanAgentTag: outsideStandardWindow,
      transitionTo: "COLLECTING_CALL_DETAILS"
    };
  }

  // --- REENGAGE: silencio a mitad del funnel activo ---
  if (!REENGAGE_STATES.has(candidate.currentState)) return null;
  // Solo si ELLA no contesto: el ultimo mensaje del historial debe ser del agente.
  const last = lastByCreatedAt(recentMessages);
  if (!last || last.role !== "agent") return null;
  if (idleMs < IDLE_BEFORE_FIRST_TOUCH_MS) return null;

  const touches = countAgentTrigger(recentMessages, REENGAGE_TRIGGER);
  if (touches >= MAX_REENGAGE_TOUCHES) return null;

  if (touches === 0) {
    // Toque 1.
    return {
      kind: "reengage",
      message: pickStable(FIRST_TOUCH_MESSAGES, candidate, 1),
      humanAgentTag: outsideStandardWindow
    };
  }

  // touches === 1: toque 2 FINAL, solo si paso suficiente desde el toque previo.
  const lastTouchAt = latestAgentTriggerAt(recentMessages, REENGAGE_TRIGGER);
  if (lastTouchAt && now.getTime() - lastTouchAt.getTime() < IDLE_BEFORE_SECOND_TOUCH_MS) return null;
  return {
    kind: "reengage",
    message: pickStable(FINAL_TOUCH_MESSAGES, candidate, 2),
    // El toque final va siempre fuera de ventana en la practica; ademas lo forzamos a etiqueta.
    humanAgentTag: true,
    markCold: true
  };
}
