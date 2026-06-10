import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MUTATING_METHOD_PATTERN = /^(?:save|record|add|create|import|update|delete)/;

export interface PersisterTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DebouncedPersister {
  schedule(): void;
  flush(): void;
}

const defaultTimers: PersisterTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export function loadSnapshot(filePath: string): Record<string, unknown> | null {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw, reviveDatesByKey);
    if (!isRecord(parsed)) {
      console.warn(`[jsonSnapshotStore] Snapshot at ${filePath} is not a JSON object; starting with empty state.`);
      return null;
    }

    return parsed;
  } catch {
    console.warn(`[jsonSnapshotStore] Could not read snapshot at ${filePath}; starting with empty state.`);
    return null;
  }
}

export function saveSnapshotAtomic(filePath: string, data: unknown): void {
  const temporaryPath = `${filePath}.tmp`;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(temporaryPath, JSON.stringify(data, null, 2), "utf8");

  try {
    renameSync(temporaryPath, filePath);
  } catch {
    rmSync(filePath, { force: true });
    renameSync(temporaryPath, filePath);
  }
}

export function createDebouncedPersister(
  persistFn: () => void,
  delayMs: number,
  timers: PersisterTimers = defaultTimers
): DebouncedPersister {
  let pendingHandle: unknown = null;

  const persistSafely = () => {
    pendingHandle = null;
    try {
      persistFn();
    } catch {
      console.warn("[jsonSnapshotStore] Failed to persist snapshot; in-memory state is still intact.");
    }
  };

  return {
    schedule() {
      if (pendingHandle !== null) {
        timers.clearTimeout(pendingHandle);
      }
      pendingHandle = timers.setTimeout(persistSafely, delayMs);
    },
    flush() {
      if (pendingHandle !== null) {
        timers.clearTimeout(pendingHandle);
      }
      persistSafely();
    }
  };
}

export function wrapWithPersistence<T extends object>(repo: T, schedule: () => void): T {
  return new Proxy(repo, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function" || typeof property !== "string") {
        return value;
      }

      const method = value as (...args: unknown[]) => unknown;
      if (!MUTATING_METHOD_PATTERN.test(property)) {
        return (...args: unknown[]) => method.apply(target, args);
      }

      return (...args: unknown[]) => {
        const result = method.apply(target, args);
        if (isPromiseLike(result)) {
          return result.then((resolved) => {
            schedule();
            return resolved;
          });
        }

        schedule();
        return result;
      };
    }
  });
}

function reviveDatesByKey(key: string, value: unknown): unknown {
  if (typeof value === "string" && key.endsWith("At") && ISO_8601_PATTERN.test(value)) {
    return new Date(value);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" && value !== null && "then" in value && typeof (value as { then: unknown }).then === "function"
  );
}
