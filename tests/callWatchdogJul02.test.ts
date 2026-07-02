import { describe, expect, it } from "vitest";
import { recoverStuckCalls, STUCK_CALL_THRESHOLD_MS } from "@/application/callWatchdog";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// WATCHDOG de llamadas atascadas (A1, 2-jul): si el webhook de fin NUNCA llega (caída de ElevenLabs,
// quota agotada a mitad de llamada — pasó EN LA LLAMADA REAL de hoy), la candidata se quedaba en
// CALL_IN_PROGRESS para siempre: sin reintento del auto-marcador y sin aviso. El watchdog la re-arma
// a CALL_NO_ANSWER (entra la maquinaria de reintento existente) y avisa a Alex.

async function seed(repository: InMemoryCandidateRepository, overrides: Partial<Candidate>): Promise<Candidate> {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: overrides.instagramUsername ?? "stuck_call" }),
      firstName: "Ana",
      age: 24,
      isAdultConfirmed: true,
      ...overrides
    })
  );
}

describe("watchdog de CALL_IN_PROGRESS atascada", () => {
  it("llamada 'en curso' desde hace más del umbral -> CALL_NO_ANSWER + nota + transición + aviso", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const stuckSince = new Date(now.getTime() - STUCK_CALL_THRESHOLD_MS - 60_000);
    const seeded = await seed(repository, { currentState: "CALL_IN_PROGRESS", updatedAt: stuckSince, callAttempts: 1 });

    const notified: string[] = [];
    const recovered = await recoverStuckCalls({
      repository,
      now,
      notify: async (r) => {
        notified.push(r.instagramUsername);
      }
    });

    expect(recovered).toHaveLength(1);
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CALL_NO_ANSWER");
    expect(after?.notes.some((n) => n.includes("WATCHDOG"))).toBe(true);
    // El contador de intentos NO se toca (eso es de noteCallAttempt al marcar).
    expect(after?.callAttempts).toBe(1);
    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.some((t) => t.trigger === "CALL_WATCHDOG" && t.toState === "CALL_NO_ANSWER")).toBe(true);
    expect(notified).toEqual(["stuck_call"]);
  });

  it("una llamada RECIENTE en curso no se toca (dentro del umbral)", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const seeded = await seed(repository, {
      instagramUsername: "fresh_call",
      currentState: "CALL_IN_PROGRESS",
      updatedAt: new Date(now.getTime() - 5 * 60_000)
    });

    const recovered = await recoverStuckCalls({ repository, now });
    expect(recovered).toHaveLength(0);
    expect((await repository.findCandidateById(seeded.id))?.currentState).toBe("CALL_IN_PROGRESS");
  });

  it("los demás estados no se tocan aunque lleven tiempo quietos", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const old = new Date(now.getTime() - 3 * 60 * 60_000);
    await seed(repository, { instagramUsername: "qualifying_idle", currentState: "QUALIFYING", updatedAt: old });
    await seed(repository, { instagramUsername: "scheduled_idle", currentState: "CALL_SCHEDULED", updatedAt: old });

    const recovered = await recoverStuckCalls({ repository, now });
    expect(recovered).toHaveLength(0);
  });

  it("idempotente: una segunda pasada no re-toca a la ya recuperada", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const stuckSince = new Date(now.getTime() - STUCK_CALL_THRESHOLD_MS - 60_000);
    const seeded = await seed(repository, { currentState: "CALL_IN_PROGRESS", updatedAt: stuckSince });

    await recoverStuckCalls({ repository, now });
    const second = await recoverStuckCalls({ repository, now: new Date(now.getTime() + 60_000) });
    expect(second).toHaveLength(0);
    const transitions = await repository.listTransitions(seeded.id);
    expect(transitions.filter((t) => t.trigger === "CALL_WATCHDOG")).toHaveLength(1);
  });

  it("un fallo al avisar NO impide la recuperación (el aviso es best-effort)", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const stuckSince = new Date(now.getTime() - STUCK_CALL_THRESHOLD_MS - 60_000);
    const seeded = await seed(repository, { currentState: "CALL_IN_PROGRESS", updatedAt: stuckSince });

    const recovered = await recoverStuckCalls({
      repository,
      now,
      notify: async () => {
        throw new Error("callmebot caído");
      }
    });
    expect(recovered).toHaveLength(1);
    expect((await repository.findCandidateById(seeded.id))?.currentState).toBe("CALL_NO_ANSWER");
  });

  it("puede reutilizar una lista ya cargada (sin segunda consulta) y respeta el umbral exacto", async () => {
    const repository = new InMemoryCandidateRepository();
    const now = new Date("2026-07-02T22:00:00Z");
    const seeded = await seed(repository, {
      currentState: "CALL_IN_PROGRESS",
      updatedAt: new Date(now.getTime() - STUCK_CALL_THRESHOLD_MS + 30_000) // AÚN dentro del umbral
    });
    const candidates = await repository.listCandidates();
    const recovered = await recoverStuckCalls({ repository, now, candidates });
    expect(recovered).toHaveLength(0);
    expect((await repository.findCandidateById(seeded.id))?.currentState).toBe("CALL_IN_PROGRESS");
  });
});
