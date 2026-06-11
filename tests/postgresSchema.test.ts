import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDbConnection, getDb } from "@/infrastructure/db/client";
import { candidates, conversationMessages } from "@/infrastructure/db/schema";

// EXCEPCIÓN ACORDADA a la regla "sin test.skip": estos tests de integración necesitan un
// PostgreSQL real y solo corren cuando TEST_DATABASE_URL está definida (apuntando SIEMPRE a
// rose_models_test, nunca a rose_models: truncan/borran filas). En máquinas sin Postgres la
// suite sigue en verde gracias a describe.runIf — es gating condicional documentado, no un skip
// permanente. Para ejecutarlos:
//   $env:TEST_DATABASE_URL = "postgres://postgres:<password>@localhost:5432/rose_models_test"
const testDbUrl = process.env.TEST_DATABASE_URL;

function extractPgErrorCode(error: unknown): string | null {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    const candidate = current as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === "string") {
      return candidate.code;
    }
    current = candidate.cause;
  }
  return null;
}

const EXPECTED_TABLES = [
  "candidates",
  "conversation_messages",
  "state_transitions",
  "negotiation_decisions",
  "conversation_feedback",
  "approved_responses",
  "ab_evaluation_cases",
  "evaluation_sessions",
  "imported_conversations"
] as const;

describe("getDb sin DATABASE_URL", () => {
  it("lanza un error claro en español si falta DATABASE_URL", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(() => getDb()).toThrowError(/DATABASE_URL/);
      expect(() => getDb()).toThrowError(/\.env\.local/);
    } finally {
      if (previous !== undefined) {
        process.env.DATABASE_URL = previous;
      }
    }
  });
});

describe.runIf(Boolean(testDbUrl))("schema Postgres (integración, rose_models_test)", () => {
  const connection = createDbConnection(testDbUrl ?? "", { max: 1 });
  const db = connection.db;

  beforeAll(async () => {
    // Vitest ejecuta los ficheros de test en paralelo y repositoryContract.test.ts TRUNCA tablas:
    // el advisory lock (mismo id allí) serializa los suites que comparten rose_models_test.
    await connection.client.unsafe("select pg_advisory_lock(727274)");
  });

  beforeEach(async () => {
    await db.delete(conversationMessages);
    await db.delete(candidates);
  });

  afterAll(async () => {
    await db.delete(conversationMessages);
    await db.delete(candidates);
    await connection.client.unsafe("select pg_advisory_unlock(727274)");
    await connection.client.end();
  });

  it("las migraciones han creado todas las tablas esperadas", async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`
    );
    const tableNames = rows.map((row) => row.table_name);
    for (const table of EXPECTED_TABLES) {
      expect(tableNames).toContain(table);
    }
  });

  it("hace un roundtrip insert/select/delete sobre candidates con los defaults del dominio", async () => {
    const username = `test_smoke_${randomUUID()}`;

    const inserted = await db.insert(candidates).values({ instagramUsername: username }).returning();
    expect(inserted).toHaveLength(1);

    const found = await db.select().from(candidates).where(eq(candidates.instagramUsername, username));
    expect(found).toHaveLength(1);
    const candidate = found[0];
    expect(candidate.currentState).toBe("NEW_LEAD");
    expect(candidate.isAdultConfirmed).toBe(false);
    expect(candidate.humanReviewStatus).toBe("NOT_REQUIRED");
    expect(candidate.objections).toEqual([]);
    expect(candidate.createdAt).toBeInstanceOf(Date);

    await db.delete(candidates).where(eq(candidates.id, candidate.id));
    const afterDelete = await db.select().from(candidates).where(eq(candidates.instagramUsername, username));
    expect(afterDelete).toHaveLength(0);
  });

  it("el índice único parcial bloquea external_message_id duplicado por candidata", async () => {
    const [candidate] = await db
      .insert(candidates)
      .values({ instagramUsername: `test_dedupe_${randomUUID()}` })
      .returning();

    await db.insert(conversationMessages).values({
      candidateId: candidate.id,
      role: "candidate",
      author: "CANDIDATE",
      content: "hola",
      externalMessageId: "ig-msg-1"
    });

    let caught: unknown = null;
    try {
      await db.insert(conversationMessages).values({
        candidateId: candidate.id,
        role: "candidate",
        author: "CANDIDATE",
        content: "hola otra vez",
        externalMessageId: "ig-msg-1"
      });
    } catch (error) {
      caught = error;
    }
    // Código 23505 = unique_violation (independiente del locale del servidor; Drizzle envuelve
    // el error de postgres.js en la cadena de `cause`).
    expect(caught).not.toBeNull();
    expect(extractPgErrorCode(caught)).toBe("23505");

    // Mensajes sin externalMessageId no chocan entre sí (el índice es parcial: WHERE ... IS NOT NULL).
    await db.insert(conversationMessages).values([
      { candidateId: candidate.id, role: "agent", author: "AI_AGENT", content: "respuesta" },
      { candidateId: candidate.id, role: "agent", author: "AI_AGENT", content: "otra respuesta" }
    ]);

    const stored = await db
      .select()
      .from(conversationMessages)
      .where(and(eq(conversationMessages.candidateId, candidate.id), sql`${conversationMessages.externalMessageId} is not null`));
    expect(stored).toHaveLength(1);
  });

  it("borrar una candidata arrastra sus mensajes (ON DELETE CASCADE, necesario para el borrado DSAR)", async () => {
    const [candidate] = await db
      .insert(candidates)
      .values({ instagramUsername: `test_cascade_${randomUUID()}` })
      .returning();

    await db.insert(conversationMessages).values({
      candidateId: candidate.id,
      role: "candidate",
      author: "CANDIDATE",
      content: "mensaje a borrar"
    });

    await db.delete(candidates).where(eq(candidates.id, candidate.id));

    const orphanMessages = await db.select().from(conversationMessages).where(eq(conversationMessages.candidateId, candidate.id));
    expect(orphanMessages).toHaveLength(0);
  });
});
