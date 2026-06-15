import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbConnection {
  db: Database;
  client: Sql;
}

/**
 * Crea una conexión independiente (la usan los tests de integración contra rose_models_test).
 * postgres.js es perezoso: no abre sockets hasta la primera query, así que construir la conexión
 * no falla aunque el servidor no esté disponible.
 */
export function createDbConnection(
  databaseUrl: string,
  options: { max?: number; prepare?: boolean; idleTimeout?: number; connectTimeout?: number } = {}
): DbConnection {
  const client = postgres(databaseUrl, {
    max: options.max ?? 5,
    // El pooler de Neon (PgBouncer transaction mode) NO soporta prepared statements: prepare:false.
    ...(options.prepare === false ? { prepare: false } : {}),
    ...(options.idleTimeout ? { idle_timeout: options.idleTimeout } : {}),
    ...(options.connectTimeout ? { connect_timeout: options.connectTimeout } : {})
  });
  return { db: drizzle({ client, schema }), client };
}

// Singleton perezoso en globalThis (mismo patrón que simulatorStore): en dev, Next.js recarga los
// módulos en caliente y sin esto cada recarga abriría un pool nuevo hasta agotar conexiones.
const globalForDb = globalThis as typeof globalThis & {
  roseDbConnection?: DbConnection;
};

/**
 * Devuelve el cliente Drizzle compartido. Solo se crea cuando hay DATABASE_URL definida; nunca al
 * importar el módulo, para que el resto de la app siga funcionando sin Postgres.
 */
export function getDb(): Database {
  if (!globalForDb.roseDbConnection) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error(
        "DATABASE_URL no está definida. Añádela a .env.local (copia el placeholder de .env.example) con la cadena de conexión de PostgreSQL antes de usar la base de datos."
      );
    }

    // Serverless (Vercel + endpoint POOLED de Neon, con "-pooler" en el host, o DB_SERVERLESS=1): pocas
    // conexiones por instancia y sin prepared statements. Directo/local (tests): comportamiento clasico.
    const isPooledServerless = /-pooler\./.test(databaseUrl) || process.env.DB_SERVERLESS === "1";
    globalForDb.roseDbConnection = isPooledServerless
      ? createDbConnection(databaseUrl, { max: 1, prepare: false, idleTimeout: 20, connectTimeout: 10 })
      : createDbConnection(databaseUrl, { max: 5 });
  }

  return globalForDb.roseDbConnection.db;
}
