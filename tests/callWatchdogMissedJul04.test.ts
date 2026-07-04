import { describe, expect, it } from "vitest";
import {
  MISSED_DISPATCH_MAX_AGE_MS,
  MISSED_DISPATCH_RETRY_DELAY_MS,
  MISSED_DISPATCH_THRESHOLD_MS,
  recoverStuckCalls,
  type StuckCallRecovery
} from "@/application/callWatchdog";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// LANZAMIENTO 3-jul (caso Ana): la cita quedó CONFIRMADA a la candidata pero el auto-marcador nunca
// disparó (encolado QStash perdido / fallo silencioso) y nadie se enteró: la candidata esperando la
// llamada y el CRM con la cita "vigente" ya pasada. Segundo barrido del watchdog: cita vencida >15 min
// sin marcar -> se reprograma a now+5min (el LLAMANTE re-encola el auto-marcador con la nueva hora) y
// se avisa a Alex. La entrega vieja de QStash, si llegara, ve la hora cambiada y NO llama (guard
// "rescheduled" del dispatch) — sin dobles llamadas.

// now con AR en horario comercial (15:00) para que el guard de franja no interfiera en los tests base.
const NOW = new Date(Date.UTC(2026, 6, 4, 18, 0));

async function seedScheduled(repository: InMemoryCandidateRepository, overrides: Partial<Candidate> = {}): Promise<Candidate> {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: overrides.instagramUsername ?? `missed_${Math.random()}` }),
      firstName: "Ana",
      age: 24,
      isAdultConfirmed: true,
      phone: "+54 9 11 5352 8311",
      currentState: "CALL_SCHEDULED",
      scheduledCallStartMs: NOW.getTime() - MISSED_DISPATCH_THRESHOLD_MS - 60_000,
      callAttempts: 0,
      ...overrides
    })
  );
}

describe("watchdog: cita vencida sin marcar (auto-marcador que nunca disparó)", () => {
  it("cita vencida >15 min con intentos restantes -> se reprograma a now+5min, nota + aviso, estado intacto", async () => {
    const repository = new InMemoryCandidateRepository();
    const seeded = await seedScheduled(repository);

    const notified: StuckCallRecovery[] = [];
    const recovered = await recoverStuckCalls({
      repository,
      now: NOW,
      notify: async (r) => {
        notified.push(r);
      }
    });

    expect(recovered).toHaveLength(1);
    expect(recovered[0].kind).toBe("MISSED_DISPATCH");
    expect(recovered[0].rearmed?.scheduledCallStartMs).toBe(NOW.getTime() + MISSED_DISPATCH_RETRY_DELAY_MS);
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CALL_SCHEDULED");
    expect(after?.scheduledCallStartMs).toBe(NOW.getTime() + MISSED_DISPATCH_RETRY_DELAY_MS);
    expect(after?.notes.some((n) => n.includes("WATCHDOG-DISPATCH"))).toBe(true);
    // El contador de intentos NO se toca (eso es de noteCallAttempt al marcar de verdad).
    expect(after?.callAttempts).toBe(0);
    expect(notified).toHaveLength(1);
    expect(notified[0].detail.length).toBeGreaterThan(0);
  });

  it("también recupera un reintento perdido en CALL_NO_ANSWER (el dispatch marca desde ahí)", async () => {
    const repository = new InMemoryCandidateRepository();
    const seeded = await seedScheduled(repository, { currentState: "CALL_NO_ANSWER", callAttempts: 1 });
    const recovered = await recoverStuckCalls({ repository, now: NOW });
    expect(recovered).toHaveLength(1);
    const after = await repository.findCandidateById(seeded.id);
    expect(after?.currentState).toBe("CALL_NO_ANSWER");
    expect(after?.scheduledCallStartMs).toBe(NOW.getTime() + MISSED_DISPATCH_RETRY_DELAY_MS);
  });

  it("una cita aún dentro del umbral (vencida hace 10 min) NO se toca", async () => {
    const repository = new InMemoryCandidateRepository();
    const seeded = await seedScheduled(repository, {
      scheduledCallStartMs: NOW.getTime() - 10 * 60_000
    });
    const recovered = await recoverStuckCalls({ repository, now: NOW });
    expect(recovered).toHaveLength(0);
    expect((await repository.findCandidateById(seeded.id))?.scheduledCallStartMs).toBe(NOW.getTime() - 10 * 60_000);
  });

  it("una cita FUTURA no se toca (obvio pero crítico)", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedScheduled(repository, { scheduledCallStartMs: NOW.getTime() + 60 * 60_000 });
    expect(await recoverStuckCalls({ repository, now: NOW })).toHaveLength(0);
  });

  it("sin intentos restantes (callAttempts >= 3) NO se re-arma (el re-enganche por IG toma el relevo)", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedScheduled(repository, { callAttempts: 3 });
    expect(await recoverStuckCalls({ repository, now: NOW })).toHaveLength(0);
  });

  it("con control manual o pausa de Alex NO se re-arma (él decide)", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedScheduled(repository, { manualControlActive: true });
    await seedScheduled(repository, { automationPaused: true });
    expect(await recoverStuckCalls({ repository, now: NOW })).toHaveLength(0);
  });

  it("fuera de la franja 9-22 LOCAL de la candidata se espera al siguiente barrido (no llamadas de madrugada)", async () => {
    const repository = new InMemoryCandidateRepository();
    // 06:00 UTC = 03:00 en Argentina -> el barrido NO re-arma ahora; la condición sigue viva para luego.
    const nightNow = new Date(Date.UTC(2026, 6, 4, 6, 0));
    const seeded = await seedScheduled(repository, {
      scheduledCallStartMs: nightNow.getTime() - MISSED_DISPATCH_THRESHOLD_MS - 60_000
    });
    expect(await recoverStuckCalls({ repository, now: nightNow })).toHaveLength(0);
    expect((await repository.findCandidateById(seeded.id))?.notes ?? []).toHaveLength(0);
  });

  it("la franja se evalúa en la zona de la candidata: 21:30 UTC = 23:30 Madrid (+34 duerme) pero 18:30 AR (se re-arma)", async () => {
    const repository = new InMemoryCandidateRepository();
    const eveningNow = new Date(Date.UTC(2026, 6, 4, 21, 30));
    const expiredAt = eveningNow.getTime() - MISSED_DISPATCH_THRESHOLD_MS - 60_000;
    const spanish = await seedScheduled(repository, { phone: "+34 612 345 678", scheduledCallStartMs: expiredAt });
    const argentine = await seedScheduled(repository, { phone: "+54 9 11 5352 8311", scheduledCallStartMs: expiredAt });
    const recovered = await recoverStuckCalls({ repository, now: eveningNow });
    expect(recovered).toHaveLength(1);
    expect(recovered[0].candidateId).toBe(argentine.id);
    expect((await repository.findCandidateById(spanish.id))?.scheduledCallStartMs).toBe(expiredAt);
  });

  it("tope de re-armados: con 3 notas WATCHDOG-DISPATCH previas ya no insiste (sin bucles infinitos)", async () => {
    const repository = new InMemoryCandidateRepository();
    await seedScheduled(repository, {
      notes: [
        "WATCHDOG-DISPATCH (1): reprogramada.",
        "WATCHDOG-DISPATCH (2): reprogramada.",
        "WATCHDOG-DISPATCH (3): reprogramada."
      ]
    });
    expect(await recoverStuckCalls({ repository, now: NOW })).toHaveLength(0);
  });

  it("una nota VENCIDA previa NO consume re-armados (revisor: el marcador VENCIDA contiene al de re-armado)", async () => {
    const repository = new InMemoryCandidateRepository();
    // Historia: una cita vieja venció (nota VENCIDA), Alex reagendó, y la nueva cita también se perdió.
    const seeded = await seedScheduled(repository, {
      notes: ["WATCHDOG-DISPATCH-VENCIDA (2026-07-03T10:00:00Z): la cita agendada quedó sin marcar."]
    });
    const recovered = await recoverStuckCalls({ repository, now: NOW });
    expect(recovered).toHaveLength(1);
    expect(recovered[0].kind).toBe("MISSED_DISPATCH");
    expect((await repository.findCandidateById(seeded.id))?.scheduledCallStartMs).toBe(
      NOW.getTime() + MISSED_DISPATCH_RETRY_DELAY_MS
    );
  });

  it("cita vencida hace MÁS de 24h: no se llama de la nada — nota + aviso a Alex una sola vez", async () => {
    const repository = new InMemoryCandidateRepository();
    const seeded = await seedScheduled(repository, {
      scheduledCallStartMs: NOW.getTime() - MISSED_DISPATCH_MAX_AGE_MS - 60_000
    });
    const notified: StuckCallRecovery[] = [];
    const first = await recoverStuckCalls({
      repository,
      now: NOW,
      notify: async (r) => {
        notified.push(r);
      }
    });
    expect(first).toHaveLength(1);
    expect(first[0].kind).toBe("MISSED_DISPATCH_EXPIRED");
    expect(first[0].rearmed).toBeUndefined();
    const after = await repository.findCandidateById(seeded.id);
    // NO se reprograma (nada de llamarla un día después de la nada): solo constancia y aviso.
    expect(after?.scheduledCallStartMs).toBe(NOW.getTime() - MISSED_DISPATCH_MAX_AGE_MS - 60_000);
    expect(after?.notes.some((n) => n.includes("WATCHDOG-DISPATCH-VENCIDA"))).toBe(true);
    // Idempotente: el segundo barrido no duplica la nota ni el aviso.
    const second = await recoverStuckCalls({ repository, now: new Date(NOW.getTime() + 60_000) });
    expect(second).toHaveLength(0);
  });

  it("el barrido de CALL_IN_PROGRESS atascada sigue funcionando igual (sin interferencias)", async () => {
    const repository = new InMemoryCandidateRepository();
    const stuck = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "in_progress_stuck" }),
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true,
        currentState: "CALL_IN_PROGRESS",
        updatedAt: new Date(NOW.getTime() - 21 * 60_000),
        callAttempts: 1
      })
    );
    const recovered = await recoverStuckCalls({ repository, now: NOW });
    expect(recovered).toHaveLength(1);
    expect(recovered[0].kind).toBe("IN_PROGRESS_STUCK");
    expect((await repository.findCandidateById(stuck.id))?.currentState).toBe("CALL_NO_ANSWER");
  });
});
