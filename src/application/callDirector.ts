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
  | "asks-more" // "¿y qué más?" / "sigue, cuéntame": avanzar agenda; tras el cierre NO es un ack (se responde el remate)
  | "asks-covered" // pregunta algo que el conocimiento cubre
  | "asks-unknown" // pregunta fuera de cobertura -> deferir a Alex ("mi socio")
  | "asks-identity" // pregunta quién es / de qué agencia -> el bot dice quién es (no defiere)
  | "asks-earnings" // pregunta cuánto se gana -> respuesta honesta sin cifras (no defiere)
  | "asks-age-policy" // pregunta el requisito de edad -> respuesta determinista (solo 18+), no defiere
  | "asks-share-figure" // pregunta la CIFRA del reparto -> responderla (inv. 3 reactivo), nunca deferir
  | "asks-salary" // pide salario/sueldo fijo -> explicar que va a porcentaje y SEGUIR negociando (Alex 17-jul)
  | "asks-bot-to-repeat" // pide que el bot repita lo último ("¿qué decías?") -> repetirlo, no deferir
  | "asks-clarification" // no entendió una PALABRA/frase del bot ("¿qué significa X?") -> explicarla en simple
  | "complains-about-share" // se queja del reparto -> negociar a la baja (lo decide el código)
  | "distrust" // desconfianza leve ("¿cómo sé que es real?") -> tranquilizar y seguir
  | "wants-human" // pide hablar con una persona -> handoff
  | "hostile-or-suspicious" // agresión/insultos/sospecha grave -> handoff
  | "not-interested" // desinterés ("no me interesa") -> cierre cálido sin presionar
  | "wants-to-think" // quiere pensarlo/consultarlo ("me lo tengo que pensar") -> cierre cálido sin contrato
  | "unclear" // ruido / no se entiende -> pedir que lo repita (no asumir asentimiento)
  | "acknowledge" // dijo algo REAL que no es pregunta ni objecion (la comprension lo entendio como charla/
  //                 respuesta): acusar con naturalidad y seguir, NUNCA fingir "no te pillo". NO cambia estado.
  | "underage" // declara ser menor de edad -> corte seguro inmediato (invariante 2 en la voz)
  | "face-refusal" // se niega EN FIRME a mostrar la cara / quiere anonimato -> reconducir y, si insiste, cerrar
  | "face-doubt" // DUDA/verguenza sobre la cara ("me da corte") -> tranquilizar con tacto, NUNCA cerrar
  | "wants-to-end"; // quiere terminar -> cerrar con contrato

export type CallDirectiveType =
  | "GIVE_DISCLOSURE" // paso 0 legal (IA + grabación)
  | "COVER_STAGE" // cubrir proactivamente una etapa de la agenda
  | "ANSWER_FROM_KNOWLEDGE" // responder una pregunta cubierta
  | "GIVE_IDENTITY" // decir quién es (soy Alex de Rose Models) ante "¿quién eres?"
  | "GIVE_EARNINGS" // responder honesto sobre ingresos (depende de ti, SIN cifras ni promesas)
  | "GIVE_AGE_POLICY" // responder el requisito de edad (solo mayores de 18, innegociable)
  | "DEFER_TO_PARTNER" // "ese punto se lo comento a mi socio y te digo"
  | "DEFEND_SHARE" // defender el valor del 70 una vez antes de bajar
  | "CONCEDE_SHARE" // bajar un escalón del reparto (con la nueva oferta)
  | "REASSURE" // tranquilizar desconfianza y continuar
  | "ACKNOWLEDGE" // acusar con naturalidad algo real que no es pregunta ni objecion, y seguir (no cambia estado)
  | "ASK_REPEAT" // no se entendió: pedir que lo repita
  | "HANDOFF_TO_ALEX" // pasar la llamada a una persona
  | "CLOSE_WITH_CONTRACT" // cerrar: "ahora te paso el contrato"
  | "CLOSE_SOFT" // cierre cálido sin contrato (no le interesa): puerta abierta
  | "CLOSE_RESCHEDULE" // la pillamos en mal momento NADA MÁS descolgar: cerrar y reagendar por Instagram
  | "CLOSE_UNDERAGE" // corte seguro: menor de edad, no se puede seguir (invariante 2)
  | "SAY_GOODBYE" // despedida corta cuando ELLA se despide con la llamada ya cerrada
  | "STAY_SILENT" // no decir nada (anti-loro: el cierre/handoff ya se repitió una vez)
  | "GIVE_SHARE_FIGURE" // re-decir la cifra AUTORIZADA vigente del reparto (respuesta reactiva, inv. 3)
  | "GIVE_NO_SALARY" // explicar que NO hay sueldo fijo (va a porcentaje) sin cerrar ni mover la escalera
  | "REPEAT_LAST_UTTERANCE" // repetir lo último que dijo el bot (ella no lo oyó)
  | "CLARIFY_LAST_UTTERANCE" // explicar en simple lo que el bot acaba de decir (no lo entendió)
  | "RECONDUCT_FACE" // 1ª negativa a la cara: tranquilizar con el conocimiento de la cara e insistir con tacto
  | "CLOSE_FACE_REJECTED"; // se niega EN FIRME tras reconducir: rechazo educado y cierre (puerta abierta)

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
  /**
   * Peticiones CONSECUTIVAS de "¿qué decías?" (ella no nos oye). A la 3ª, el audio está roto en su
   * dirección -> handoff (igual que unclearStreak, que cubre la dirección contraria). Sin este tope,
   * un ASR roto emitiendo "¿cómo?" dejaría al bot repitiéndose para siempre (riesgo del revisor jul-2026).
   */
  repeatRequestStreak: number;
  handedOff: boolean;
  handoffReason?: CallHandoffReason;
  /** Negativas EN FIRME a mostrar la cara ya vistas: a la 1ª se reconduce, a la 2ª se cierra (invariante:
   * la cara es imprescindible, pero nunca se cierra de golpe — se tranquiliza e insiste primero). */
  faceObjectionCount: number;
  /** true tras cualquier cierre: es pegajoso (no reabre guion ni negociación). */
  closed: boolean;
  /** Qué cierre se dio, para repetirlo si la candidata sigue hablando tras cerrar. */
  closeDirective?: "CLOSE_WITH_CONTRACT" | "CLOSE_SOFT" | "CLOSE_RESCHEDULE" | "CLOSE_UNDERAGE" | "CLOSE_FACE_REJECTED";
  /**
   * Veces que ya se REPITIÓ el mensaje terminal (cierre o handoff) tras darlo (jul-2026, anti-loro con
   * habla real: la simulación repetía el contrato en bucle a cada "dale"). Tope 1: después, silencio.
   */
  terminalRepeats: number;
  /** true cuando ya se dio la despedida corta post-cierre (no despedirse dos veces). */
  goodbyeSaid: boolean;
}

export interface CallDirective {
  type: CallDirectiveType;
  /** Etapa objetivo (para COVER_STAGE). */
  stageId?: CallAgendaStageId;
  /** Oferta de reparto (para CONCEDE_SHARE y adjunta al introducir MONEY). */
  shareOffer?: CallRevenueShareOffer;
  /** Motivo del handoff (para HANDOFF_TO_ALEX). */
  handoffReason?: CallHandoffReason;
  /** Qué cierre precedió a la despedida (para SAY_GOODBYE: tras un rechazo no se promete escribir). */
  afterClose?: CallDirectorState["closeDirective"];
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
    repeatRequestStreak: 0,
    faceObjectionCount: 0,
    handedOff: false,
    closed: false,
    terminalRepeats: 0,
    goodbyeSaid: false
  };
}

export function decideCallDirective(input: {
  state: CallDirectorState;
  signal: CallCandidateSignal;
  /**
   * true si la señal la produjo la COMPRENSIÓN IA (understander), no el oído determinista. Replay-crítico:
   * la reproducción NO re-llama al LLM, así que una señal refinada por IA JAMÁS debe mutar estado (el efecto
   * no se reconstruiría). Con el flag, asks-earnings NO adelanta la etapa MONEY (queda en GIVE_EARNINGS,
   * sin estado); el adelanto solo ocurre cuando la señal viene del clasificador (idéntico en vivo y replay).
   */
  refinedByUnderstander?: boolean;
}): CallTurnDecision {
  const { state, signal } = input;

  // Una vez transferida a Alex, el bot no retoma el guion: la persona tiene el control (invariante 4).
  // Anti-loro (jul-2026): el mensaje de handoff se repite UNA vez como máximo; después, silencio (el
  // colgado lo pone el timeout de silencio del agente de voz). handedOff sigue pegajoso siempre.
  if (state.handedOff) {
    if (state.terminalRepeats >= 1) {
      return { directive: { type: "STAY_SILENT" }, nextState: state };
    }
    return {
      directive: { type: "HANDOFF_TO_ALEX", handoffReason: state.handoffReason },
      nextState: { ...state, terminalRepeats: state.terminalRepeats + 1 }
    };
  }

  // SEGURIDAD (invariante 2 en la voz): si declara ser menor de edad, corte seguro INMEDIATO, antes que
  // nada (incluso antes de la apertura): no se cualifica ni se vende contenido adulto a una menor. Es
  // determinista (no pasa por el LLM) y pegajoso (no reabre el guion). Equivale a "Edad<18 -> CLOSED" del DM.
  // Si YA está cortada por menor, la re-declaración no repite el corte íntegro en bucle: cae al bloque
  // closed (repite una vez / silencio) — misma familia anti-loro, invariante 2 intacto.
  if (signal === "underage" && !(state.closed && state.closeDirective === "CLOSE_UNDERAGE")) {
    return closeUnderage(state);
  }

  // SEGURIDAD antes de la apertura (bloqueante del revisor 3-jul): quien DESCUELGA pidiendo una persona
  // o con hostilidad no recibe el pitch — antes el gate de la apertura se tragaba la señal y el guion
  // seguía (invariante 4 roto en el primer aliento). Guardado a !disclosureGiven: el resto de estados
  // (incluido el corte por menor, que fija disclosureGiven=true) no cambian de camino.
  if (!state.disclosureGiven && (signal === "wants-human" || signal === "hostile-or-suspicious")) {
    return handoff(state, signal === "wants-human" ? "asked-for-human" : "suspicion-or-aggression");
  }

  // Paso 0 obligatorio: apertura legal (IA + grabación). Siempre lo primero, pase lo que pase.
  if (!state.disclosureGiven) {
    return {
      directive: { type: "GIVE_DISCLOSURE" },
      nextState: { ...state, disclosureGiven: true }
    };
  }

  // Cierre pegajoso: ya se cerró. No reabre guion ni negociación; la seguridad sigue escalando (agresión /
  // pide persona). Una pregunta REAL se responde (decisión de Alex: "el bot siempre contesta primero"),
  // sin tocar el estado. El cierre solo se repite UNA vez (anti-loro jul-2026: la simulación repetía el
  // contrato en bucle a cada "dale, perfecto"); después, silencio. Si ELLA se despide, despedida corta.
  if (state.closed) {
    // Corte por MENOR (invariante 2): el corte ES el corte. A una menor declarada no se le vuelve a
    // hablar de negocio: ni ingresos, ni conocimiento, ni "te escribo/te paso con mi socio" (promesas de
    // contacto). CUALQUIER señal repite el corte una vez y después silencio; Alex ya queda avisado por el
    // webhook de fin (underage -> CLOSED + notificación).
    if (state.closeDirective !== "CLOSE_UNDERAGE") {
      if (signal === "hostile-or-suspicious") return handoff(state, "suspicion-or-aggression");
      if (signal === "wants-human") return handoff(state, "asked-for-human");
      if (signal === "asks-covered") return { directive: { type: "ANSWER_FROM_KNOWLEDGE" }, nextState: state };
      if (signal === "asks-identity") return { directive: { type: "GIVE_IDENTITY" }, nextState: state };
      if (signal === "asks-earnings") return { directive: { type: "GIVE_EARNINGS" }, nextState: state };
      if (signal === "asks-age-policy") return { directive: { type: "GIVE_AGE_POLICY" }, nextState: state };
      // Pregunta la cifra tras el cierre: se re-dice la AUTORIZADA vigente (reactivo, inv. 3), sin reabrir.
      if (signal === "asks-share-figure") {
        return {
          directive: { type: "GIVE_SHARE_FIGURE", shareOffer: callRevenueShareOfferForStep(state.revenueShareStep) },
          nextState: state
        };
      }
      if (signal === "asks-bot-to-repeat") {
        // Con tope también aquí: si tras el cierre sigue sin oírnos, silencio (no un bucle de repeticiones).
        if (state.repeatRequestStreak >= 2) return { directive: { type: "STAY_SILENT" }, nextState: state };
        return {
          directive: { type: "REPEAT_LAST_UTTERANCE" },
          nextState: { ...state, repeatRequestStreak: state.repeatRequestStreak + 1 }
        };
      }
      if (signal === "asks-clarification") return { directive: { type: "CLARIFY_LAST_UTTERANCE" }, nextState: state };
      if (signal === "distrust") return { directive: { type: "REASSURE" }, nextState: state };
      // Salario tras el cierre: se explica igual (no hay sueldo fijo), sin reabrir nada (Alex 17-jul).
      if (signal === "asks-salary") return { directive: { type: "GIVE_NO_SALARY" }, nextState: state };
      // La CARA tras el cierre (1a llamada real 17-jul: "¿puedo taparla en un video?" se IGNORABA y se
      // repetia el cierre): se reconduce con el conocimiento de la cara, sin tocar el estado (ya esta
      // cerrada; no cuenta hacia ningun cierre nuevo). Responder a lo que pregunta > repetir el cierre.
      // EXCEPCIÓN (Alex 20-jul): tras un CIERRE POR RECHAZO DE LA CARA, se mantiene FIRME (no reconduce):
      // reconducir sonaba incoherente ("¿seguimos?" tras "no podríamos seguir"). Cae al cierre firme de abajo
      // (repite el cierre una vez y luego silencio); tras OTRO cierre (contrato/soft) sí reconduce.
      if ((signal === "face-refusal" || signal === "face-doubt") && state.closeDirective !== "CLOSE_FACE_REJECTED") {
        return { directive: { type: "RECONDUCT_FACE" }, nextState: state };
      }
      // Queja del reparto o pregunta no cubierta tras el cierre: se defiere (sin cifras y sin reabrir la
      // negociación — invariante 3); nunca se repite el discurso del contrato como "respuesta".
      if (signal === "complains-about-share" || signal === "asks-unknown") {
        return { directive: { type: "DEFER_TO_PARTNER" }, nextState: state };
      }
      if (signal === "wants-to-end" || signal === "not-interested" || signal === "wants-to-think") {
        if (state.goodbyeSaid) return { directive: { type: "STAY_SILENT" }, nextState: state };
        // La despedida se adapta: si ELLA está declinando (aunque el cierre fuera con contrato), variante
        // de declive (sin "¡Genial!" ni promesa de escribirle); si solo se despide, según el cierre dado.
        const declining = signal === "not-interested" || signal === "wants-to-think";
        return {
          directive: { type: "SAY_GOODBYE", afterClose: declining ? "CLOSE_SOFT" : state.closeDirective },
          nextState: { ...state, goodbyeSaid: true }
        };
      }
      // Un ASENTIMIENTO puro tras el cierre ("dale", "vale", "perfecto") es un ACK del cierre, no "no lo
      // oí": re-soltarle el contrato entero sonaba a disco rayado (sweep R9 10-jul, decisión deliberada que
      // sustituye al "repetir una vez" de jul-02 PARA ESTE caso). Silencio; el colgado lo pone la
      // plataforma. Un `unclear` (de verdad no lo oyó) SÍ conserva la repetición única de abajo.
      if (signal === "follows-along" || signal === "none" || signal === "acknowledge") {
        return { directive: { type: "STAY_SILENT" }, nextState: state };
      }
    }
    // Tras la despedida ya dada, cualquier coletilla ("chau chau", "vale") es SILENCIO: re-soltar el
    // cierre a quien se está despidiendo era el último loro que quedaba (barrido jul-2026).
    if (state.goodbyeSaid || state.terminalRepeats >= 1) {
      return { directive: { type: "STAY_SILENT" }, nextState: state };
    }
    return {
      directive: { type: state.closeDirective ?? "CLOSE_WITH_CONTRACT" },
      nextState: { ...state, terminalRepeats: state.terminalRepeats + 1 }
    };
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

  // Cualquier otra señal (sí se entendió) reinicia la racha de "no entiendo". La racha de "no me oye"
  // (repeatRequestStreak) se reinicia con cualquier señal que NO sea pedir repetición otra vez.
  let s: CallDirectorState = state.unclearStreak === 0 ? state : { ...state, unclearStreak: 0 };
  if (signal !== "asks-bot-to-repeat" && s.repeatRequestStreak !== 0) {
    s = { ...s, repeatRequestStreak: 0 };
  }

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
    case "face-refusal":
      // Se niega EN FIRME a mostrar la cara / quiere anonimato. La cara es imprescindible, PERO nunca se
      // cierra de golpe (Alex: "hay que intentarlo"): a la 1ª se RECONDUCE (tranquiliza con el conocimiento
      // de la cara e insiste con tacto); si INSISTE tras haber reconducido, rechazo educado y cierre con la
      // puerta abierta. Determinista y pegajoso (el cierre no lo decide el LLM — invariante 1).
      if (s.faceObjectionCount >= 1) {
        return closeFaceRejected({ ...s, faceObjectionCount: s.faceObjectionCount + 1 });
      }
      return { directive: { type: "RECONDUCT_FACE" }, nextState: { ...s, faceObjectionCount: s.faceObjectionCount + 1 } };
    case "face-doubt":
      // DUDA/verguenza de la cara (no un rechazo en firme): se tranquiliza con el conocimiento de la cara e
      // insiste con tacto, pero NUNCA cuenta hacia el cierre ni cierra (Alex: "no queremos que lo deje nunca
      // por una duda"). Es la red determinista por si la comprensión no lo cazó.
      return { directive: { type: "RECONDUCT_FACE" }, nextState: s };
    case "asks-unknown":
      return { directive: { type: "DEFER_TO_PARTNER" }, nextState: s };
    case "asks-covered":
      return { directive: { type: "ANSWER_FROM_KNOWLEDGE" }, nextState: s };
    case "asks-identity":
      return { directive: { type: "GIVE_IDENTITY" }, nextState: s };
    case "asks-earnings":
      // 1ª LLAMADA REAL (Alba, 21-jul): "¿cuánto me vais a pagar?" → el bot esquivaba ("sería mentirte una
      // cifra") y VOLVÍA a su guion, dejando el dinero para más tarde = robótico ("sigue su estructura sí o
      // sí", Alex). Como con asks-share-figure: si el dinero AÚN no se presentó, se presenta AQUÍ (la
      // conversación manda; el orden lo sigue decidiendo el código y la cifra es la autorizada del script).
      // El matiz honesto (no prometer cantidades, depende de su constancia) vive en el brief del MONEY.
      // SOLO con señal del oído determinista (replay-idéntico); refinada por IA -> GIVE_EARNINGS sin estado.
      if (!input.refinedByUnderstander && !s.coveredStages.includes("MONEY")) {
        return {
          directive: { type: "COVER_STAGE", stageId: "MONEY", shareOffer: initialCallRevenueShareOffer() },
          nextState: { ...s, coveredStages: [...s.coveredStages, "MONEY"] }
        };
      }
      return { directive: { type: "GIVE_EARNINGS" }, nextState: s };
    case "asks-age-policy":
      return { directive: { type: "GIVE_AGE_POLICY" }, nextState: s };
    case "asks-share-figure":
      // Pregunta la CIFRA del reparto (invariante 3 es reactivo: preguntada, se dice — jamás se defiere).
      // Si el dinero aún no se presentó, se presenta AHORA (cuenta como etapa cubierta); si ya se presentó,
      // se repite la cifra AUTORIZADA vigente del escalón (70/30, 65/35 o 60/40), sin mover la negociación.
      if (!s.coveredStages.includes("MONEY")) {
        return {
          directive: { type: "COVER_STAGE", stageId: "MONEY", shareOffer: initialCallRevenueShareOffer() },
          nextState: { ...s, coveredStages: [...s.coveredStages, "MONEY"] }
        };
      }
      return {
        directive: { type: "GIVE_SHARE_FIGURE", shareOffer: callRevenueShareOfferForStep(s.revenueShareStep) },
        nextState: s
      };
    case "asks-salary":
      // Pide salario/sueldo fijo (Alex 17-jul, 1a llamada real: el bot CERRABA en vez de contestar). Se le
      // explica que va a porcentaje (determinista, sin cifras) y la conversacion SIGUE donde estaba: no se
      // cierra, no se defiere y NO se mueve la escalera (si luego insiste con el %, esa queja negocia normal).
      return { directive: { type: "GIVE_NO_SALARY" }, nextState: s };
    case "asks-bot-to-repeat": {
      // No lo oyó: se repite lo último dicho (lo aporta el responder desde el transcript), sin avanzar.
      // A la TERCERA petición consecutiva, el audio hacia ella está roto -> a una persona (como unclear).
      const streak = s.repeatRequestStreak + 1;
      if (streak >= UNCLEAR_HANDOFF_THRESHOLD) {
        return handoff(s, "audio-unintelligible");
      }
      return { directive: { type: "REPEAT_LAST_UTTERANCE" }, nextState: { ...s, repeatRequestStreak: streak } };
    }
    case "asks-clarification":
      // No entendió una palabra/frase del bot: se explica en SIMPLE (el redactor reformula lo ya dicho
      // con los hechos de la etapa; jamás "mi socio" para el propio vocabulario del bot — 3-jul).
      return { directive: { type: "CLARIFY_LAST_UTTERANCE" }, nextState: s };
    case "distrust":
      return { directive: { type: "REASSURE" }, nextState: s };
    case "acknowledge":
      // Dijo algo REAL que no es pregunta ni objecion (la comprension lo entendio como charla/respuesta, no
      // ruido): se ACUSA con naturalidad y se sigue, en vez de fingir "no te pillo, repite" (sweep AR 14-jul,
      // candidata que contaba su vida). NO cambia estado -> replay-safe (el replay ya trata el unclear-
      // inteligible como reinicio-de-racha sin avanzar el guion, asi que live y replay coinciden).
      return { directive: { type: "ACKNOWLEDGE" }, nextState: s };
    case "wants-to-end": {
      // jul-2026 (decisión de Alex): si quiere colgar NADA MÁS descolgar (aún no se ha explicado NADA),
      // no tiene sentido "te paso el contrato" — se cierra con reagendado por Instagram y el sistema
      // reabre el agendado por el DM (webhook de fin -> COLLECTING_CALL_DETAILS). Si el pitch ya avanzó,
      // el cierre con contrato de siempre.
      const substantiveCovered = s.coveredStages.filter((id) => id !== "CLOSE").length;
      if (substantiveCovered === 0) {
        return {
          directive: { type: "CLOSE_RESCHEDULE" },
          nextState: { ...s, closed: true, closeDirective: "CLOSE_RESCHEDULE" }
        };
      }
      return closeWithContract(s);
    }
    case "follows-along":
    case "asks-more":
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

// Rechazo educado por negarse EN FIRME a la cara (tras reconducir). Cierre pegajoso, puerta abierta. El
// texto del rechazo YA incluye la despedida, así que se marca goodbyeSaid: una coletilla posterior no
// re-suelta el rechazo (iría a silencio); la SEGURIDAD (hostil/pide persona) y una pregunta REAL siguen
// atendiéndose en el bloque de cierre antes del silencio.
function closeFaceRejected(state: CallDirectorState): CallTurnDecision {
  return {
    directive: { type: "CLOSE_FACE_REJECTED" },
    nextState: { ...state, closed: true, closeDirective: "CLOSE_FACE_REJECTED", goodbyeSaid: true }
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
