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
  | "asks-identity" // pregunta quién es / de qué agencia -> el bot dice quién es (no defiere)
  | "asks-earnings" // pregunta cuánto se gana -> respuesta honesta sin cifras (no defiere)
  | "complains-about-share" // se queja del reparto -> negociar a la baja (lo decide el código)
  | "distrust" // desconfianza leve ("¿cómo sé que es real?") -> tranquilizar y seguir
  | "wants-human" // pide hablar con una persona -> handoff
  | "hostile-or-suspicious" // agresión/insultos/sospecha grave -> handoff
  | "not-interested" // desinterés ("no me interesa") -> cierre cálido sin presionar
  | "wants-to-think" // quiere pensarlo/consultarlo ("me lo tengo que pensar") -> cierre cálido sin contrato
  | "unclear" // ruido / no se entiende -> pedir que lo repita (no asumir asentimiento)
  | "underage" // declara ser menor de edad -> corte seguro inmediato (invariante 2 en la voz)
  | "wants-to-end"; // quiere terminar -> cerrar con contrato

export type CallDirectiveType =
  | "GIVE_DISCLOSURE" // paso 0 legal (IA + grabación)
  | "COVER_STAGE" // cubrir proactivamente una etapa de la agenda
  | "ANSWER_FROM_KNOWLEDGE" // responder una pregunta cubierta
  | "GIVE_IDENTITY" // decir quién es (soy Alex de Rose Models) ante "¿quién eres?"
  | "GIVE_EARNINGS" // responder honesto sobre ingresos (depende de ti, SIN cifras ni promesas)
  | "DEFER_TO_PARTNER" // "ese punto se lo comento a mi socio y te digo"
  | "DEFEND_SHARE" // defender el valor del 70 una vez antes de bajar
  | "CONCEDE_SHARE" // bajar un escalón del reparto (con la nueva oferta)
  | "REASSURE" // tranquilizar desconfianza y continuar
  | "ASK_REPEAT" // no se entendió: pedir que lo repita
  | "HANDOFF_TO_ALEX" // pasar la llamada a una persona
  | "CLOSE_WITH_CONTRACT" // cerrar: "ahora te paso el contrato"
  | "CLOSE_SOFT" // cierre cálido sin contrato (no le interesa): puerta abierta
  | "CLOSE_UNDERAGE"; // corte seguro: menor de edad, no se puede seguir (invariante 2)

export type CallHandoffReason =
  | "asked-for-human"
  | "suspicion-or-aggression"
  | "share-rejected-at-floor"
  | "audio-unintelligible";

/** Tras esta racha de turnos seguidos sin entender, se pasa la llamada a una persona (STT roto). */
const UNCLEAR_HANDOFF_THRESHOLD = 3;

export interface CallDirectorState {
  disclosureGiven: boolean;
  coveredStages: CallAgendaStageId[];
  revenueShareStep: CallRevenueShareStep;
  /** true cuando ya se defendió el 70 una vez (la siguiente queja ya negocia a la baja). */
  shareDefended: boolean;
  /** Turnos consecutivos sin entender (se reinicia al entender algo); a UNCLEAR_HANDOFF_THRESHOLD -> handoff. */
  unclearStreak: number;
  handedOff: boolean;
  handoffReason?: CallHandoffReason;
  /** true tras cualquier cierre: es pegajoso (no reabre guion ni negociación). */
  closed: boolean;
  /** Qué cierre se dio, para repetirlo si la candidata sigue hablando tras cerrar. */
  closeDirective?: "CLOSE_WITH_CONTRACT" | "CLOSE_SOFT" | "CLOSE_UNDERAGE";
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
  return {
    disclosureGiven: false,
    coveredStages: [],
    revenueShareStep: 0,
    shareDefended: false,
    unclearStreak: 0,
    handedOff: false,
    closed: false
  };
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

  // SEGURIDAD (invariante 2 en la voz): si declara ser menor de edad, corte seguro INMEDIATO, antes que
  // nada (incluso antes de la apertura): no se cualifica ni se vende contenido adulto a una menor. Es
  // determinista (no pasa por el LLM) y pegajoso (no reabre el guion). Equivale a "Edad<18 -> CLOSED" del DM.
  if (signal === "underage") {
    return closeUnderage(state);
  }

  // Paso 0 obligatorio: apertura legal (IA + grabación). Siempre lo primero, pase lo que pase.
  if (!state.disclosureGiven) {
    return {
      directive: { type: "GIVE_DISCLOSURE" },
      nextState: { ...state, disclosureGiven: true }
    };
  }

  // Cierre pegajoso: ya se cerró. No reabre guion ni negociación; solo escala por seguridad (agresión /
  // pide persona). Cualquier otra cosa repite el MISMO cierre que se dio (contrato o cálido).
  if (state.closed) {
    if (signal === "hostile-or-suspicious") return handoff(state, "suspicion-or-aggression");
    if (signal === "wants-human") return handoff(state, "asked-for-human");
    return { directive: { type: state.closeDirective ?? "CLOSE_WITH_CONTRACT" }, nextState: state };
  }

  // No se entendió (ruido/STT): pedir que lo repita, sin avanzar el guion. Si pasa varias veces seguidas,
  // se pasa la llamada a una persona (audio roto persistente) en vez de quedarse en bucle.
  if (signal === "unclear") {
    const streak = state.unclearStreak + 1;
    if (streak >= UNCLEAR_HANDOFF_THRESHOLD) {
      return handoff(state, "audio-unintelligible");
    }
    return { directive: { type: "ASK_REPEAT" }, nextState: { ...state, unclearStreak: streak } };
  }

  // Cualquier otra señal (sí se entendió) reinicia la racha de "no entiendo".
  const s: CallDirectorState = state.unclearStreak === 0 ? state : { ...state, unclearStreak: 0 };

  switch (signal) {
    case "hostile-or-suspicious":
      return handoff(s, "suspicion-or-aggression");
    case "wants-human":
      return handoff(s, "asked-for-human");
    case "complains-about-share":
      return negotiateShare(s);
    case "not-interested":
      return closeSoft(s);
    case "wants-to-think":
      // Quiere pensarlo: mismo trato que un cierre cálido (sin contrato, puerta abierta), nunca DEFER ni
      // "¿me lo repites?". Alex puede hacer seguimiento luego. No se fuerza el contrato a quien duda.
      return closeSoft(s);
    case "asks-unknown":
      return { directive: { type: "DEFER_TO_PARTNER" }, nextState: s };
    case "asks-covered":
      return { directive: { type: "ANSWER_FROM_KNOWLEDGE" }, nextState: s };
    case "asks-identity":
      return { directive: { type: "GIVE_IDENTITY" }, nextState: s };
    case "asks-earnings":
      return { directive: { type: "GIVE_EARNINGS" }, nextState: s };
    case "distrust":
      return { directive: { type: "REASSURE" }, nextState: s };
    case "wants-to-end":
      return closeWithContract(s);
    case "follows-along":
    case "none":
    default:
      return advanceAgenda(s);
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
  // En la PRIMERA queja (escalón 0) se defiende el valor del 70 una vez antes de empezar a bajar.
  if (state.revenueShareStep === 0 && !state.shareDefended) {
    return { directive: { type: "DEFEND_SHARE" }, nextState: { ...state, shareDefended: true } };
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
  return {
    directive: { type: "CLOSE_WITH_CONTRACT" },
    nextState: { ...state, coveredStages, closed: true, closeDirective: "CLOSE_WITH_CONTRACT" }
  };
}

// Cierre cálido sin contrato: la candidata no está interesada. No se presiona; puerta abierta. Pegajoso.
function closeSoft(state: CallDirectorState): CallTurnDecision {
  return {
    directive: { type: "CLOSE_SOFT" },
    nextState: { ...state, closed: true, closeDirective: "CLOSE_SOFT" }
  };
}

// Corte seguro por minoría de edad (invariante 2 en la voz): cierre educado y definitivo, sin contrato ni
// reapertura. Marca disclosureGiven para que un turno posterior no dispare la apertura legal tras el corte.
function closeUnderage(state: CallDirectorState): CallTurnDecision {
  return {
    directive: { type: "CLOSE_UNDERAGE" },
    nextState: { ...state, disclosureGiven: true, closed: true, closeDirective: "CLOSE_UNDERAGE" }
  };
}
