import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ConversationEngine } from "@/application/conversationEngine";
import { InMemoryImportedConversationRepository } from "@/application/conversationImport";
import { InMemoryEvaluationRepository } from "@/application/evaluationRunner";
import { createLlmProviders } from "@/application/llmFactory";
import { InMemoryConversationFeedbackRepository } from "@/application/responseFeedback";
import { getDb } from "@/infrastructure/db/client";
import {
  createDebouncedPersister,
  loadSnapshot,
  saveSnapshotAtomic,
  wrapWithPersistence
} from "@/infrastructure/persistence/jsonSnapshotStore";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { PostgresCandidateRepository } from "@/infrastructure/repositories/postgresCandidateRepository";
import { PostgresConversationFeedbackRepository } from "@/infrastructure/repositories/postgresConversationFeedbackRepository";
import { PostgresEvaluationRepository } from "@/infrastructure/repositories/postgresEvaluationRepository";
import { PostgresImportedConversationRepository } from "@/infrastructure/repositories/postgresImportedConversationRepository";
import type {
  CandidateRepository,
  ConversationFeedbackRepository,
  EvaluationRepository,
  ImportedConversationRepository
} from "@/infrastructure/repositories/types";

// En Vercel (serverless) el FS es de solo lectura salvo /tmp: si el modo json llega a activarse (p. ej.
// fallback ante un fallo de Neon) el snapshot debe ir a /tmp para no lanzar EROFS. En produccion el modo
// recomendado es postgres, asi que esto solo es una red de seguridad para no tumbar el proceso.
const SNAPSHOT_FILE_PATH = process.env.VERCEL
  ? join(tmpdir(), "rose-simulator-snapshot.json")
  : join(process.cwd(), "data", "simulator-snapshot.json");
const SNAPSHOT_DEBOUNCE_MS = 300;

/**
 * Modo de persistencia del simulador (env `PERSISTENCE`):
 * - "postgres": repositorios Postgres (Drizzle) sobre DATABASE_URL, sin snapshot JSON.
 * - "json" (default): repos in-memory con snapshot JSON write-through en data/ (comportamiento previo).
 * - "memory": repos in-memory volátiles (se pierde todo al reiniciar; útil en tests/demos).
 *
 * Invariante 6 (trazas honestas): el modo ACTIVO real se expone vía getPersistenceMode() y se
 * registra una vez al arrancar; si postgres falla y se hace fallback, el modo expuesto cambia.
 */
export type PersistenceMode = "postgres" | "json" | "memory";

interface SimulatorRepositories {
  candidateRepository: CandidateRepository;
  feedbackRepository: ConversationFeedbackRepository;
  evaluationRepository: EvaluationRepository;
  importedConversationRepository: ImportedConversationRepository;
}

const globalForSimulator = globalThis as typeof globalThis & {
  roseSimulatorRepositories?: SimulatorRepositories;
  roseSimulatorEngine?: ConversationEngine;
  rosePersistenceMode?: PersistenceMode;
  roseSnapshotExitHookRegistered?: boolean;
};

function resolveRequestedMode(): PersistenceMode {
  const raw = process.env.PERSISTENCE?.trim().toLowerCase();
  if (raw === "postgres" || raw === "json" || raw === "memory") {
    return raw;
  }
  // Compatibilidad: SIMULATOR_SNAPSHOT=off era la forma de pedir el modo volátil antes de PERSISTENCE.
  const fallbackMode: PersistenceMode = process.env.SIMULATOR_SNAPSHOT === "off" ? "memory" : "json";
  if (raw) {
    console.warn(`[simulatorStore] Valor de PERSISTENCE no reconocido ("${raw}"); se usa "${fallbackMode}".`);
  }
  return fallbackMode;
}

function buildMemoryRepositories(): SimulatorRepositories {
  return {
    candidateRepository: new InMemoryCandidateRepository(),
    feedbackRepository: new InMemoryConversationFeedbackRepository(),
    evaluationRepository: new InMemoryEvaluationRepository(),
    importedConversationRepository: new InMemoryImportedConversationRepository()
  };
}

function buildJsonRepositories(): SimulatorRepositories {
  const candidateRepository = new InMemoryCandidateRepository();
  const feedbackRepository = new InMemoryConversationFeedbackRepository();
  const evaluationRepository = new InMemoryEvaluationRepository();
  const importedConversationRepository = new InMemoryImportedConversationRepository();

  try {
    mkdirSync(dirname(SNAPSHOT_FILE_PATH), { recursive: true });
  } catch {
    console.warn("[simulatorStore] Could not create the data/ directory; snapshot persistence may fail.");
  }

  const snapshot = loadSnapshot(SNAPSHOT_FILE_PATH);
  if (snapshot) {
    candidateRepository.restoreSnapshot(snapshot.candidateRepository);
    feedbackRepository.restoreSnapshot(snapshot.feedbackRepository);
    evaluationRepository.restoreSnapshot(snapshot.evaluationRepository);
    importedConversationRepository.restoreSnapshot(snapshot.importedConversationRepository);
  }

  const persister = createDebouncedPersister(() => {
    saveSnapshotAtomic(SNAPSHOT_FILE_PATH, {
      version: 1,
      savedAt: new Date(),
      candidateRepository: candidateRepository.toSnapshot(),
      feedbackRepository: feedbackRepository.toSnapshot(),
      evaluationRepository: evaluationRepository.toSnapshot(),
      importedConversationRepository: importedConversationRepository.toSnapshot()
    });
  }, SNAPSHOT_DEBOUNCE_MS);

  // El evento "exit" corre codigo sincrono incluso tras process.exit(): cubre la ventana
  // de debounce (~300ms) en la que una mutacion aun no se ha volcado a disco.
  if (!globalForSimulator.roseSnapshotExitHookRegistered) {
    globalForSimulator.roseSnapshotExitHookRegistered = true;
    process.once("exit", () => persister.flush());
  }

  return {
    candidateRepository: wrapWithPersistence(candidateRepository, persister.schedule),
    feedbackRepository: wrapWithPersistence(feedbackRepository, persister.schedule),
    evaluationRepository: wrapWithPersistence(evaluationRepository, persister.schedule),
    importedConversationRepository: wrapWithPersistence(importedConversationRepository, persister.schedule)
  };
}

// ---------------------------------------------------------------------------
// Modo postgres con fallback determinista al modo json en el PRIMER uso
// ---------------------------------------------------------------------------

// Códigos que indican "no se pudo hablar con el servidor" (socket de Node, timeouts de
// postgres.js, autenticación/BD inexistente del servidor). Un error de datos (p. ej. 23505
// unique_violation) NUNCA dispara el fallback: debe propagarse.
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "28000",
  "28P01",
  "3D000",
  "57P03"
]);

function isConnectionError(error: unknown, depth = 0): boolean {
  if (depth > 10 || typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && CONNECTION_ERROR_CODES.has(candidate.code)) {
    return true;
  }
  if (error instanceof AggregateError && error.errors.some((inner) => isConnectionError(inner, depth + 1))) {
    return true;
  }
  return isConnectionError(candidate.cause, depth + 1);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" && value !== null && "then" in value && typeof (value as { then: unknown }).then === "function"
  );
}

interface PostgresFallbackController {
  hasSucceeded: boolean;
  failedOver: boolean;
  ensureFallback(): SimulatorRepositories;
  failOver(error: unknown): void;
}

function createFallbackController(): PostgresFallbackController {
  let fallbackRepositories: SimulatorRepositories | null = null;
  return {
    hasSucceeded: false,
    failedOver: false,
    ensureFallback(): SimulatorRepositories {
      if (!fallbackRepositories) {
        fallbackRepositories = buildJsonRepositories();
      }
      return fallbackRepositories;
    },
    failOver(error: unknown): void {
      this.failedOver = true;
      // Invariante 6: el modo expuesto debe reflejar lo que corre DE VERDAD a partir de ahora.
      globalForSimulator.rosePersistenceMode = "json";
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(
        `[simulatorStore] PERSISTENCE=postgres, pero la conexión a PostgreSQL falló en el primer uso (${detail}). ` +
          'Fallback determinista al modo "json" (snapshot en data/simulator-snapshot.json). ' +
          "Revisa DATABASE_URL en .env.local y que el servicio de PostgreSQL esté arrancado."
      );
    }
  };
}

function callRepositoryMethod(repository: object, property: PropertyKey, args: unknown[]): unknown {
  const method: unknown = Reflect.get(repository, property);
  if (typeof method !== "function") {
    throw new Error(`El repositorio de fallback no implementa ${String(property)}.`);
  }
  return (method as (...callArgs: unknown[]) => unknown).apply(repository, args);
}

/**
 * Proxy que delega en el repo Postgres y, SOLO si la primera operación falla por un error de
 * conexión (nunca por errores de datos, y nunca después de un primer éxito — cambiar de almacén a
 * mitad de sesión divergiría los datos en silencio), conmuta TODOS los repos al modo json y
 * reintenta la llamada contra el fallback.
 */
function withJsonFallback<T extends object>(
  primary: T,
  controller: PostgresFallbackController,
  select: (repositories: SimulatorRepositories) => T
): T {
  return new Proxy(primary, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        if (controller.failedOver) {
          return callRepositoryMethod(select(controller.ensureFallback()), property, args);
        }

        const result = method.apply(target, args);
        if (!isPromiseLike(result)) {
          return result;
        }

        return result.then(
          (resolved: unknown) => {
            controller.hasSucceeded = true;
            return resolved;
          },
          (error: unknown) => {
            if (!controller.hasSucceeded && !controller.failedOver && isConnectionError(error)) {
              controller.failOver(error);
              return callRepositoryMethod(select(controller.ensureFallback()), property, args);
            }
            throw error;
          }
        );
      };
    }
  });
}

function buildPostgresRepositories(): SimulatorRepositories {
  const db = getDb();
  const controller = createFallbackController();
  return {
    candidateRepository: withJsonFallback(new PostgresCandidateRepository(db), controller, (repos) => repos.candidateRepository),
    feedbackRepository: withJsonFallback(
      new PostgresConversationFeedbackRepository(db),
      controller,
      (repos) => repos.feedbackRepository
    ),
    evaluationRepository: withJsonFallback(
      new PostgresEvaluationRepository(db),
      controller,
      (repos) => repos.evaluationRepository
    ),
    importedConversationRepository: withJsonFallback(
      new PostgresImportedConversationRepository(db),
      controller,
      (repos) => repos.importedConversationRepository
    )
  };
}

// ---------------------------------------------------------------------------
// Singleton perezoso (patrón globalThis para sobrevivir al hot-reload de Next.js)
// ---------------------------------------------------------------------------

function ensureSimulatorRepositories(): SimulatorRepositories {
  if (globalForSimulator.roseSimulatorRepositories) {
    return globalForSimulator.roseSimulatorRepositories;
  }

  // Si se recrean los repos (p. ej. hot-reload con globals parciales), el engine cacheado
  // quedaria apuntando a un repo descartado cuyas escrituras nadie veria ni persistiria.
  globalForSimulator.roseSimulatorEngine = undefined;

  const requestedMode = resolveRequestedMode();
  let activeMode: PersistenceMode = requestedMode;
  let repositories: SimulatorRepositories;

  if (requestedMode === "postgres") {
    if (!process.env.DATABASE_URL) {
      console.warn(
        "[simulatorStore] PERSISTENCE=postgres pero DATABASE_URL no está definida en .env.local; " +
          'fallback determinista al modo "json" (snapshot en data/simulator-snapshot.json).'
      );
      activeMode = "json";
      repositories = buildJsonRepositories();
    } else {
      try {
        repositories = buildPostgresRepositories();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn(
          `[simulatorStore] PERSISTENCE=postgres pero no se pudo crear el cliente de PostgreSQL (${detail}); ` +
            'fallback determinista al modo "json".'
        );
        activeMode = "json";
        repositories = buildJsonRepositories();
      }
    }
  } else if (requestedMode === "memory") {
    repositories = buildMemoryRepositories();
  } else {
    repositories = buildJsonRepositories();
  }

  globalForSimulator.rosePersistenceMode = activeMode;
  globalForSimulator.roseSimulatorRepositories = repositories;
  // Invariante 6 (no mentir sobre el proveedor real): se anuncia UNA vez el modo activo.
  console.info(`[simulatorStore] Persistencia activa: ${activeMode}`);
  return repositories;
}

/** Modo de persistencia ACTIVO real (puede diferir del pedido si hubo fallback). */
export function getPersistenceMode(): PersistenceMode {
  ensureSimulatorRepositories();
  return globalForSimulator.rosePersistenceMode ?? "json";
}

export function getSimulatorRepository(): CandidateRepository {
  return ensureSimulatorRepositories().candidateRepository;
}

export function getSimulatorEngine(): ConversationEngine {
  if (!globalForSimulator.roseSimulatorEngine) {
    const providers = createLlmProviders();
    globalForSimulator.roseSimulatorEngine = new ConversationEngine({
      repository: getSimulatorRepository(),
      understandingProvider: providers.understandingProvider,
      draftingProvider: providers.draftingProvider,
      automationMode: providers.config.automationMode
    });
  }

  return globalForSimulator.roseSimulatorEngine;
}

export function getFeedbackRepository(): ConversationFeedbackRepository {
  return ensureSimulatorRepositories().feedbackRepository;
}

export function getEvaluationRepository(): EvaluationRepository {
  return ensureSimulatorRepositories().evaluationRepository;
}

export function getImportedConversationRepository(): ImportedConversationRepository {
  return ensureSimulatorRepositories().importedConversationRepository;
}
