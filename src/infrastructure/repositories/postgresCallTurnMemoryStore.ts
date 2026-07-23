import { and, asc, eq, gt, sql } from "drizzle-orm";
import { CallCandidateSignalSchema, type CallTurnMemoryStore, type StoredCallTurnSignal } from "../../application/callTurnMemory";
import type { Database } from "../db/client";
import { callTurnMemory } from "../db/schema";

/**
 * MEMORIA DE LLAMADA en Postgres (Fase 1, 23-jul). Filas pequeñas, clave (call_key, turn_index) con upsert
 * idempotente: reintentos o turnos re-procesados no duplican. Las filas de llamadas ANTERIORES de la misma
 * candidata no estorban: el candado de frase del responder las descarta (el transcript nuevo no coincide) y
 * el upsert del turno 0 de la llamada nueva las va sobrescribiendo.
 */
export class PostgresCallTurnMemoryStore implements CallTurnMemoryStore {
  constructor(private readonly db: Database) {}

  async load(callKey: string): Promise<StoredCallTurnSignal[]> {
    const rows = await this.db
      .select()
      .from(callTurnMemory)
      // TTL de 4h (revisor 23-jul, defensa en profundidad): si el clear de apertura fallara (Neon parpadea),
      // las filas de una llamada ANTERIOR no sobreviven de todas formas — ninguna llamada dura 4 horas. De
      // paso evita retención indefinida de la última llamada.
      .where(and(eq(callTurnMemory.callKey, callKey), gt(callTurnMemory.createdAt, sql`now() - interval '4 hours'`)))
      .orderBy(asc(callTurnMemory.turnIndex));
    // La señal se valida con Zod al rehidratar (regla de infraestructura): una fila corrupta o de una
    // versión vieja del código se DESCARTA (el responder degrada ese turno al camino clásico), nunca revienta.
    const records: StoredCallTurnSignal[] = [];
    for (const row of rows) {
      const parsed = CallCandidateSignalSchema.safeParse(row.signal);
      if (!parsed.success) continue;
      records.push({
        turnIndex: row.turnIndex,
        utterance: row.utterance,
        signal: parsed.data,
        refinedByUnderstander: row.refinedByUnderstander
      });
    }
    return records;
  }

  async save(callKey: string, record: StoredCallTurnSignal): Promise<void> {
    const row = {
      callKey,
      turnIndex: record.turnIndex,
      utterance: record.utterance,
      signal: record.signal,
      refinedByUnderstander: record.refinedByUnderstander
    };
    await this.db
      .insert(callTurnMemory)
      .values(row)
      .onConflictDoUpdate({
        target: [callTurnMemory.callKey, callTurnMemory.turnIndex],
        set: { utterance: row.utterance, signal: row.signal, refinedByUnderstander: row.refinedByUnderstander }
      });
  }

  /** Limpieza opcional al terminar una llamada (webhook de fin): borra la memoria de esa candidata. */
  async clear(callKey: string): Promise<void> {
    await this.db.delete(callTurnMemory).where(and(eq(callTurnMemory.callKey, callKey)));
  }
}
