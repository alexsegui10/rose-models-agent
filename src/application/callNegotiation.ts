/**
 * Escalera de negociacion del reparto de ingresos para el canal de VOZ (la llamada).
 *
 * Autorizacion explicita de Alex (16-jun-2026): SOLO en la llamada, si la candidata se queja del
 * reparto, el bot puede bajar del 70 al 65 y, si aun lo ve imposible, al 60. De 60 NO se baja nunca.
 *
 * Invariantes que respeta:
 *  - Invariante 1: el ESCALON lo decide el codigo (este modulo), no el modelo. El modelo solo redacta
 *    la oferta numerica que este modulo determina; jamas inventa otro porcentaje.
 *  - Invariante 3: en el canal de CHAT (DM) esto NO aplica — alli la negociacion sigue escalando a Alex.
 *    Los niveles 65/60 son exclusivos de voz, como ya anticipaba el contenido del repo.
 *  - Nunca es proactivo: el bot solo baja un escalon cuando la candidata insiste/rechaza, nunca de motu
 *    propio ni para "cerrar antes".
 *
 * Todo lo exportado lleva prefijo `call`/`Call` a proposito: este modulo es SOLO del canal de voz y no
 * debe importarse jamas desde el pipeline de chat/DM (el nombre lo deja claro y evita autocompletados).
 *
 * El % indicado es SIEMPRE el que se queda la modelo (la agencia se queda el resto).
 */

/** Porcentajes (para la modelo) de cada escalon, de la oferta inicial al suelo. No editar sin OK de Alex. */
export const CALL_REVENUE_SHARE_LADDER = [70, 65, 60] as const;

/** Suelo absoluto: por debajo de este % para la modelo no se negocia jamas en la llamada. */
export const CALL_REVENUE_SHARE_FLOOR = 60;

/** Escalon de la negociacion: 0 = oferta inicial (70), 1 = primera concesion (65), 2 = suelo (60). */
export type CallRevenueShareStep = 0 | 1 | 2;

export interface CallRevenueShareOffer {
  /** % que se queda la modelo en este escalon (70 / 65 / 60). */
  modelShare: number;
  /** % que se queda la agencia (100 - modelShare). */
  agencyShare: number;
  /** Escalon al que corresponde la oferta. */
  step: CallRevenueShareStep;
  /** true si ya estamos en el suelo (60): el bot no puede ofrecer menos, es la oferta final. */
  isFloor: boolean;
}

const LAST_STEP: CallRevenueShareStep = (CALL_REVENUE_SHARE_LADDER.length - 1) as CallRevenueShareStep;

/** Devuelve la oferta de reparto correspondiente a un escalon de la escalera. */
export function callRevenueShareOfferForStep(step: CallRevenueShareStep): CallRevenueShareOffer {
  const modelShare = CALL_REVENUE_SHARE_LADDER[step];
  return {
    modelShare,
    agencyShare: 100 - modelShare,
    step,
    isFloor: step >= LAST_STEP
  };
}

/**
 * Dado el escalon actual, devuelve el SIGUIENTE escalon cuando la candidata sigue rechazando el reparto.
 * Nunca pasa del suelo (60): si ya estamos en el ultimo escalon, se queda ahi.
 */
export function nextCallRevenueShareStep(currentStep: CallRevenueShareStep): CallRevenueShareStep {
  if (currentStep >= LAST_STEP) {
    return LAST_STEP;
  }
  return (currentStep + 1) as CallRevenueShareStep;
}

/** Oferta inicial de la llamada (lo que se dice de entrada / si pregunta): 70 para la modelo. */
export function initialCallRevenueShareOffer(): CallRevenueShareOffer {
  return callRevenueShareOfferForStep(0);
}
