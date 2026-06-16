/**
 * Director de la llamada de voz: dado dónde estamos en la llamada y la señal (intención) de lo último
 * que dijo la candidata, decide DETERMINISTAMENTE qué hace el bot en este turno. Es el equivalente al
 * `responsePlanner` del DM, pero para la llamada.
 *
 * Invariante 1: el código decide la acción y los datos (qué etapa, qué porcentaje, cuándo deferir o
 * pasar a Alex); el modelo solo redacta en voz lo que este director ya decidió. La clasificación de la
 * señal (NLU) es una capa aparte (reutilizará el extractor/comprensión del DM); aquí se recibe ya
 * clasificada para que el director sea puro y testeable.
 *
 * Invariante 4: cualquier handoff a Alex es pegajoso — una vez transferida, el bot no retoma el guion.
 */

import { nextCallAgendaStage, type CallAgendaStageId } from "./callAgenda";
import {
  callRevenueShareOfferForStep,
  initialCallRevenueShareOffer,
  nextCallRevenueShareStep,
  type CallRevenueShareOffer,
  type CallRevenueShareStep
} from "./callNegotiation";

/** Intención clasificada de lo último que dijo la candidata (la NLU la produce; el director la consume). */
export type CallCandidateSignal =
  | "none" // arranque / nada relevante: el bot lleva el guion
  | "follows-along" // asiente / ok / sigue: avanzar agenda
  | "asks-covered" // pregunta algo que el conocimiento cubre
  | "asks-unknown" // pregunta fuera de cobertura -> deferir a Alex ("mi socio")
  | "complains-about-share" // se queja del reparto -> negociar a la baja (lo decide el código)
  | "distrust" // desconfianza leve ("¿cómo sé que es real?") -> tranquilizar y seguir
  | "wants-human" // pide hablar con una persona -> handoff
  | "hostile-or-suspicious" // agresión/insultos/sospecha grave -> handoff
  | "wants-to-end"; // quiere terminar -> cerrar con contrato

export type CallDirectiveType =
  | "GIVE_DISCLOSURE" // paso 0 legal (IA + grabación)
  | "COVER_STAGE" // cubrir proactivamente una etapa de la agenda
  | "ANSWER_FROM_KNOWLEDGE" // responder una pregunta cubierta
  | "DEFER_TO_PARTNER" // "ese punto se lo comento a mi socio y te digo"
  | "CONCEDE_SHARE" // bajar un escalón del reparto (con la nueva oferta)
  | "REASSURE" // tranquilizar desconfianza y continuar
  | "HANDOFF_TO_ALEX" // pasar la llamada a una persona
  | "CLOSE_WITH_CONTRACT"; // cerrar: "ahora te paso el contrato"

export type CallHandoffReason = "asked-for-human" | "suspicion-or-aggression" | "share-rejected-at-floor";

export interface CallDirectorState {
  disclosureGiven: boolean;
  coveredStages: CallAgendaStageId[];
  revenueShareStep: CallRevenueShareStep;
  handedOff: boolean;
  handoffReason?: CallHandoffReason;
  /** true tras cerrar con el contrato: el cierre es pegajoso (no reabre guion ni negociación). */
  closed: boolean;
}

export interface CallDirective {
  type: CallDirectiveType;
  /** Etapa objetivo (para COVER_STAGE). */
  stageId?: CallAgendaStageId;
  /** Oferta de reparto (para CONCEDE_SHARE y adjunta al introducir MONEY). */
  shareOffer?: CallRevenueShareOffer;
  /** Motivo del handoff (para HANDOFF_TO_ALEX). */
  handoffReason?: CallHandoffReason;
}

export interface CallTurnDecision {
  directive: CallDirective;
  nextState: CallDirectorState;
}

export function initialCallDirectorState(): CallDirectorState {
  return { disclosureGiven: false, coveredStages: [], revenueShareStep: 0, handedOff: false, closed: false };
}

export function decideCallDirective(input: { state: CallDirectorState; signal: CallCandidateSignal }): CallTurnDecision {
  const { state, signal } = input;

  // Una vez transferida a Alex, el bot no retoma el guion: la persona tiene el control (invariante 4).
  if (state.handedOff) {
    return {
      directive: { type: "HANDOFF_TO_ALEX", handoffReason: state.handoffReason },
      nextState: state
    };
  }

  // Paso 0 obligatorio: apertura legal (IA + grabación). Siempre lo primero, pase lo que pase.
  if (!state.disclosureGiven) {
    return {
      directive: { type: "GIVE_DISCLOSURE" },
      nextState: { ...state, disclosureGiven: true }
    };
  }

  // Cierre pegajoso: ya se dijo "te paso el contrato". No reabre guion ni negociación; solo escala por
  // seguridad (agresión / pide persona). Cualquier otra cosa repite un cierre cálido.
  if (state.closed) {
    if (signal === "hostile-or-suspicious") return handoff(state, "suspicion-or-aggression");
    if (signal === "wants-human") return handoff(state, "asked-for-human");
    return { directive: { type: "CLOSE_WITH_CONTRACT" }, nextState: state };
  }

  switch (signal) {
    case "hostile-or-suspicious":
      return handoff(state, "suspicion-or-aggression");
    case "wants-human":
      return handoff(state, "asked-for-human");
    case "complains-about-share":
      return negotiateShare(state);
    case "asks-unknown":
      return { directive: { type: "DEFER_TO_PARTNER" }, nextState: state };
    case "asks-covered":
      return { directive: { type: "ANSWER_FROM_KNOWLEDGE" }, nextState: state };
    case "distrust":
      return { directive: { type: "REASSURE" }, nextState: state };
    case "wants-to-end":
      return closeWithContract(state);
    case "follows-along":
    case "none":
    default:
      return advanceAgenda(state);
  }
}

function handoff(state: CallDirectorState, reason: CallHandoffReason): CallTurnDecision {
  return {
    directive: { type: "HANDOFF_TO_ALEX", handoffReason: reason },
    nextState: { ...state, handedOff: true, handoffReason: reason }
  };
}

function negotiateShare(state: CallDirectorState): CallTurnDecision {
  // No se concede sin haber presentado antes el reparto: si se queja del % y aún no se ha cubierto
  // MONEY, primero se presenta el 70/30 (cubriendo la etapa), y ya las siguientes quejas negocian.
  if (!state.coveredStages.includes("MONEY")) {
    return {
      directive: { type: "COVER_STAGE", stageId: "MONEY", shareOffer: initialCallRevenueShareOffer() },
      nextState: { ...state, coveredStages: [...state.coveredStages, "MONEY"] }
    };
  }
  const currentOffer = callRevenueShareOfferForStep(state.revenueShareStep);
  if (currentOffer.isFloor) {
    // Ya en el suelo (60) y sigue rechazando: fuera del margen autorizado del bot -> lo decide Alex.
    return handoff(state, "share-rejected-at-floor");
  }
  const nextStep = nextCallRevenueShareStep(state.revenueShareStep);
  return {
    directive: { type: "CONCEDE_SHARE", shareOffer: callRevenueShareOfferForStep(nextStep) },
    nextState: { ...state, revenueShareStep: nextStep }
  };
}

function advanceAgenda(state: CallDirectorState): CallTurnDecision {
  const next = nextCallAgendaStage(state.coveredStages);
  if (!next || next.id === "CLOSE") {
    return closeWithContract(state);
  }
  const directive: CallDirective = { type: "COVER_STAGE", stageId: next.id };
  if (next.id === "MONEY") {
    // Al introducir el dinero, la cifra inicial es determinista (70/30); la negociación viene aparte.
    directive.shareOffer = initialCallRevenueShareOffer();
  }
  return { directive, nextState: { ...state, coveredStages: [...state.coveredStages, next.id] } };
}

function closeWithContract(state: CallDirectorState): CallTurnDecision {
  // El cierre marca CLOSE como cubierta y fija `closed` (cierre pegajoso: no reabre guion ni negociación).
  const close: CallAgendaStageId = "CLOSE";
  const coveredStages = state.coveredStages.includes(close) ? state.coveredStages : [...state.coveredStages, close];
  return { directive: { type: "CLOSE_WITH_CONTRACT" }, nextState: { ...state, coveredStages, closed: true } };
}
