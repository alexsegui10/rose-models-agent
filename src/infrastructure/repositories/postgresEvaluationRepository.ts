import { desc, eq } from "drizzle-orm";
import {
  ABEvaluationCaseSchema,
  EvaluationSessionSchema,
  type ABEvaluationCase,
  type EvaluationSession
} from "@/domain/evaluation";
import type { Database } from "../db/client";
import { abEvaluationCases, evaluationSessions } from "../db/schema";
import { isUuid, warnInvalidRow } from "./postgresUtils";
import type { EvaluationRepository, RecordABDecisionInput } from "./types";

type ABCaseRow = typeof abEvaluationCases.$inferSelect;
type ABCaseInsert = typeof abEvaluationCases.$inferInsert;
type SessionRow = typeof evaluationSessions.$inferSelect;
type SessionInsert = typeof evaluationSessions.$inferInsert;

export class PostgresEvaluationRepository implements EvaluationRepository {
  constructor(private readonly db: Database) {}

  async saveABCase(abCase: ABEvaluationCase): Promise<ABEvaluationCase> {
    // Validación Zod en el límite antes de escribir (los runs jsonb se validan completos).
    const parsed = ABEvaluationCaseSchema.parse(abCase);
    const row: ABCaseInsert = {
      id: parsed.id,
      createdAt: parsed.createdAt,
      blind: parsed.blind,
      initialState: parsed.initialState,
      profileVisibility: parsed.profileVisibility,
      messages: parsed.messages,
      modelA: parsed.modelA,
      modelB: parsed.modelB,
      runA: parsed.runA,
      runB: parsed.runB,
      winner: parsed.winner ?? null,
      styleRating: parsed.styleRating ?? null,
      note: parsed.note ?? null
    };
    await this.db.insert(abEvaluationCases).values(row).onConflictDoUpdate({ target: abEvaluationCases.id, set: row });
    return parsed;
  }

  async listABCases(): Promise<ABEvaluationCase[]> {
    const rows = await this.db.select().from(abEvaluationCases).orderBy(desc(abEvaluationCases.createdAt));
    return rows.map(rowToABCase).filter((item): item is ABEvaluationCase => item !== null);
  }

  async recordABDecision(input: RecordABDecisionInput): Promise<ABEvaluationCase> {
    // Mismo mensaje de error que InMemoryEvaluationRepository (contrato compartido).
    if (!isUuid(input.id)) {
      throw new Error("AB evaluation not found.");
    }

    const updated = await this.db
      .update(abEvaluationCases)
      .set({ winner: input.winner, styleRating: input.styleRating ?? null, note: input.note ?? null })
      .where(eq(abEvaluationCases.id, input.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw new Error("AB evaluation not found.");
    }

    const mapped = rowToABCase(row);
    if (!mapped) {
      throw new Error("El caso A/B existe pero su fila no pasa la validación Zod del dominio.");
    }
    return mapped;
  }

  async saveSession(session: EvaluationSession): Promise<EvaluationSession> {
    const parsed = EvaluationSessionSchema.parse(session);
    const row: SessionInsert = {
      id: parsed.id,
      conversationId: parsed.conversationId,
      model: parsed.model,
      createdAt: parsed.createdAt,
      turnFeedback: parsed.turnFeedback,
      playbackTurns: parsed.playbackTurns ?? null,
      summary: parsed.summary ?? null
    };
    await this.db.insert(evaluationSessions).values(row).onConflictDoUpdate({ target: evaluationSessions.id, set: row });
    return parsed;
  }

  async getSession(id: string): Promise<EvaluationSession | null> {
    if (!isUuid(id)) {
      return null;
    }

    const rows = await this.db.select().from(evaluationSessions).where(eq(evaluationSessions.id, id)).limit(1);
    return rows[0] ? rowToSession(rows[0]) : null;
  }

  async listSessions(): Promise<EvaluationSession[]> {
    const rows = await this.db.select().from(evaluationSessions).orderBy(desc(evaluationSessions.createdAt));
    return rows.map(rowToSession).filter((item): item is EvaluationSession => item !== null);
  }
}

// Los payloads jsonb (runs, turnos de playback, summary) se rehidratan SIEMPRE a través del Zod
// del dominio; una fila inválida se ignora con aviso, nunca lanza (lectura defensiva).
function rowToABCase(row: ABCaseRow): ABEvaluationCase | null {
  const parsed = ABEvaluationCaseSchema.safeParse({
    id: row.id,
    createdAt: row.createdAt,
    blind: row.blind,
    initialState: row.initialState,
    profileVisibility: row.profileVisibility,
    messages: row.messages,
    modelA: row.modelA,
    modelB: row.modelB,
    runA: row.runA,
    runB: row.runB,
    winner: row.winner ?? undefined,
    styleRating: row.styleRating ?? undefined,
    note: row.note ?? undefined
  });
  if (!parsed.success) {
    warnInvalidRow("ab_evaluation_cases", row.id, parsed.error);
    return null;
  }
  return parsed.data;
}

function rowToSession(row: SessionRow): EvaluationSession | null {
  const parsed = EvaluationSessionSchema.safeParse({
    id: row.id,
    conversationId: row.conversationId,
    model: row.model,
    createdAt: row.createdAt,
    turnFeedback: row.turnFeedback,
    playbackTurns: row.playbackTurns ?? undefined,
    summary: row.summary ?? undefined
  });
  if (!parsed.success) {
    warnInvalidRow("evaluation_sessions", row.id, parsed.error);
    return null;
  }
  return parsed.data;
}
