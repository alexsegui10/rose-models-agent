/**
 * MEMORIA DE LLAMADA (Fase 1 del cambio de estructura, Alex 23-jul): la llamada RECUERDA la señal resuelta
 * de cada turno (oído determinista o comprensión IA) en vez de reconstruirla a ciegas re-clasificando el
 * transcript. Es la pieza que desbloquea la Fase 2 (comprensión IA en TODOS los turnos): una señal entendida
 * por la IA queda guardada y el "replay" la reproduce EXACTA — se acaba la restricción "la IA no puede mutar
 * estado porque el replay no la reproduce".
 *
 * DISEÑO A PRUEBA DE FALLOS (paracaídas, invariante 6):
 *  - La memoria es OPCIONAL y best-effort: sin memoria (simulador, tests, DB caída, candidate_id ausente) el
 *    responder usa el camino de SIEMPRE (re-clasificación + reconciliaciones). Una llamada JAMÁS se rompe
 *    por la memoria.
 *  - Cada registro guarda la FRASE del turno: al reproducir, un registro solo se usa si su frase coincide
 *    EXACTA con la del transcript en ese índice (si ElevenLabs re-fragmenta turnos o el transcript cambia,
 *    el registro se descarta y ese turno cae al camino clásico). Nunca se aplica una señal a la frase
 *    equivocada.
 *  - Guardar es fire-and-forget: no añade latencia al turno ni puede tirar la respuesta.
 */

import { z } from "zod";
import type { CallCandidateSignal } from "./callDirector";

// Lista COMPLETA de señales (para validar filas de la DB al rehidratar). Doble candado en compilación:
// `satisfies` garantiza que cada valor existe en la unión, y `_exhaustive` que la unión no tiene valores
// fuera de la lista (si se añade una señal al director sin añadirla aquí, el typecheck ROMPE).
const CALL_SIGNAL_VALUES = [
  "none",
  "follows-along",
  "asks-more",
  "asks-covered",
  "asks-unknown",
  "asks-identity",
  "asks-earnings",
  "asks-age-policy",
  "asks-share-figure",
  "asks-salary",
  "asks-bot-to-repeat",
  "asks-clarification",
  "complains-about-share",
  "distrust",
  "wants-human",
  "hostile-or-suspicious",
  "not-interested",
  "wants-to-think",
  "unclear",
  "acknowledge",
  "underage",
  "face-refusal",
  "face-doubt",
  "wants-to-end"
] as const satisfies readonly CallCandidateSignal[];
type MissingSignal = Exclude<CallCandidateSignal, (typeof CALL_SIGNAL_VALUES)[number]>;
const _exhaustive: MissingSignal extends never ? true : never = true;
void _exhaustive;

/** Valida una señal rehidratada de la DB: fila corrupta/vieja -> descartar (el turno cae al camino clásico). */
export const CallCandidateSignalSchema = z.enum(CALL_SIGNAL_VALUES);

/** Señal resuelta de un turno de la candidata, tal y como se decidió EN VIVO. */
export interface StoredCallTurnSignal {
  /** Índice del turno de la candidata dentro de la llamada (0-based, tras fusionar fragmentos). */
  turnIndex: number;
  /** La frase (saneada/truncada igual que al guardar) — candado de coincidencia para no aplicar mal. */
  utterance: string;
  /** La señal que se resolvió en vivo (oído o comprensión). */
  signal: CallCandidateSignal;
  /** true si la señal la produjo la comprensión IA (se reproduce con el mismo flag en el director). */
  refinedByUnderstander: boolean;
}

/** Cómo se sanea la frase para guardar/comparar (mismo saneo en las dos puntas, o el candado no casa). */
export function turnMemoryUtteranceKey(utterance: string): string {
  return utterance.replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Contrato del almacén (Postgres en producción; in-memory en simulador/tests). */
export interface CallTurnMemoryStore {
  /** Registros de la llamada, ordenados por turnIndex. Errores -> lanzar; el caller degrada a sin-memoria. */
  load(callKey: string): Promise<StoredCallTurnSignal[]>;
  /** Guarda (upsert idempotente) el turno. Best-effort: el caller lo llama fire-and-forget. */
  save(callKey: string, record: StoredCallTurnSignal): Promise<void>;
  /** Borra la memoria de la candidata (se llama al ARRANCAR una llamada nueva). */
  clear(callKey: string): Promise<void>;
}

/**
 * Prepara la memoria para un turno (lo llama el endpoint). LLAMADA NUEVA (el bot aún no habló = petición de
 * la apertura) -> se LIMPIA la memoria de la llamada anterior de esta candidata y se arranca vacía: sin esto,
 * una fila vieja podía coincidir por casualidad en el turno 0 (un "sí"/"hola" idéntico) y aplicar una señal
 * de OTRA llamada (p. ej. un not-interested viejo cerraría la llamada nueva). Con la llamada YA en curso ->
 * carga los registros. Los errores SUBEN (el caller degrada a sin-memoria, best-effort).
 */
export async function prepareCallTurnMemory(
  store: CallTurnMemoryStore,
  callKey: string,
  callAlreadyStarted: boolean
): Promise<CallTurnMemoryInput> {
  if (!callAlreadyStarted) {
    await store.clear(callKey);
    return { records: [], save: (record) => store.save(callKey, record) };
  }
  return { records: await store.load(callKey), save: (record) => store.save(callKey, record) };
}

/** Memoria ya cargada + cómo persistir el turno en vivo (lo que recibe el responder). */
export interface CallTurnMemoryInput {
  /** Registros cargados ANTES del turno (1 SELECT por turno, fuera del hot-path del LLM). */
  records: readonly StoredCallTurnSignal[];
  /** Persiste la señal del turno EN VIVO (el responder lo llama fire-and-forget, jamás bloquea). */
  save?: (record: StoredCallTurnSignal) => Promise<void>;
}
