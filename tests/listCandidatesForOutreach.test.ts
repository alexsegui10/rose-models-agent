import { describe, expect, it } from "vitest";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// listCandidatesForOutreach: candidatas inactivas (lastMessageAt <= idleSinceMs) candidatas a re-enganche.
// NO en estados terminales (CLOSED/REJECTED/CALL_SCHEDULED/CALL_COMPLETED), NO con control manual/pausa.
// CALL_NO_ANSWER SI entra (para el reschedule).
describe("listCandidatesForOutreach", () => {
  const NOW = Date.now();
  const IDLE_SINCE = NOW - 20 * 60 * 60 * 1000; // hace 20h

  async function seed(repo: InMemoryCandidateRepository) {
    // Inactiva (hace 30h) y en estado activo -> ENTRA.
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "idle_qualifying" }),
        currentState: "QUALIFYING",
        lastMessageAt: new Date(NOW - 30 * 60 * 60 * 1000)
      })
    );
    // Reciente (hace 5h) -> NO entra (no idle suficiente).
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "reciente" }),
        currentState: "QUALIFYING",
        lastMessageAt: new Date(NOW - 5 * 60 * 60 * 1000)
      })
    );
    // CALL_NO_ANSWER inactiva -> ENTRA (para el reschedule).
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "no_answer" }),
        currentState: "CALL_NO_ANSWER",
        callAttempts: 3,
        lastMessageAt: new Date(NOW - 40 * 60 * 60 * 1000)
      })
    );
    // Estados terminales/revision-humana/avanzados -> NO entran aunque esten inactivos (defensa en
    // profundidad del invariante 4: el repo no trae candidatas en revision humana).
    for (const state of [
      "CLOSED",
      "REJECTED",
      "WAITING_HUMAN_REVIEW",
      "HUMAN_INTERVENTION_REQUIRED",
      "APPROVED",
      "READY_TO_SCHEDULE",
      "CALL_SCHEDULED",
      "CALL_IN_PROGRESS",
      "CALL_COMPLETED"
    ] as const) {
      await repo.saveCandidate(
        normalizeCandidate({
          ...createCandidate({ instagramUsername: `excl_${state}` }),
          currentState: state,
          lastMessageAt: new Date(NOW - 40 * 60 * 60 * 1000)
        })
      );
    }
    // Pausada / control manual -> NO entran.
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "pausada" }),
        currentState: "QUALIFYING",
        automationPaused: true,
        lastMessageAt: new Date(NOW - 40 * 60 * 60 * 1000)
      })
    );
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "manual" }),
        currentState: "QUALIFYING",
        manualControlActive: true,
        lastMessageAt: new Date(NOW - 40 * 60 * 60 * 1000)
      })
    );
    // Sin lastMessageAt -> NO entra (nunca recibio mensaje suyo).
    await repo.saveCandidate(
      normalizeCandidate({ ...createCandidate({ instagramUsername: "sin_fecha" }), currentState: "QUALIFYING" })
    );
  }

  it("devuelve solo las inactivas en estado re-enganchable, excluyendo terminales/pausadas", async () => {
    const repo = new InMemoryCandidateRepository();
    await seed(repo);

    const result = await repo.listCandidatesForOutreach(IDLE_SINCE);
    const usernames = result.map((c) => c.instagramUsername).sort();

    expect(usernames).toEqual(["idle_qualifying", "no_answer"]);
  });

  it("sin candidatas inactivas devuelve lista vacia", async () => {
    const repo = new InMemoryCandidateRepository();
    await repo.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "reciente" }),
        currentState: "QUALIFYING",
        lastMessageAt: new Date(NOW - 1 * 60 * 60 * 1000)
      })
    );
    expect(await repo.listCandidatesForOutreach(IDLE_SINCE)).toEqual([]);
  });
});
