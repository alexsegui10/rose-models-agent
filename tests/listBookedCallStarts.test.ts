import { describe, expect, it } from "vitest";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// listBookedCallStarts: devuelve los instantes de inicio (ms UTC) de las llamadas YA agendadas (estado
// CALL_SCHEDULED con scheduledCallStartMs). Lo usa el agendado para no solapar dos llamadas.
describe("listBookedCallStarts", () => {
  it("devuelve solo los startMs de candidatas en CALL_SCHEDULED con hora fijada", async () => {
    const repository = new InMemoryCandidateRepository();

    await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "agendada_a" }),
        currentState: "CALL_SCHEDULED",
        scheduledCallStartMs: 1_750_000_000_000
      })
    );
    await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "agendada_b" }),
        currentState: "CALL_SCHEDULED",
        scheduledCallStartMs: 1_750_100_000_000
      })
    );
    // En CALL_SCHEDULED pero SIN hora fijada: no aporta hueco reservado.
    await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "agendada_sin_hora" }),
        currentState: "CALL_SCHEDULED"
      })
    );
    // Otra candidata cualificando con una hora vieja en el campo: no cuenta (no está agendada).
    await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "cualificando" }),
        currentState: "QUALIFYING",
        scheduledCallStartMs: 1_750_200_000_000
      })
    );

    const booked = await repository.listBookedCallStarts();

    expect(booked).toHaveLength(2);
    expect(booked).toContain(1_750_000_000_000);
    expect(booked).toContain(1_750_100_000_000);
    expect(booked).not.toContain(1_750_200_000_000);
  });

  it("sin candidatas agendadas devuelve lista vacía", async () => {
    const repository = new InMemoryCandidateRepository();
    await repository.saveCandidate(
      normalizeCandidate({ ...createCandidate({ instagramUsername: "nueva" }), currentState: "NEW_LEAD" })
    );
    expect(await repository.listBookedCallStarts()).toEqual([]);
  });
});
