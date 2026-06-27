import { describe, expect, it, vi } from "vitest";
import { scheduleCallDispatch } from "@/infrastructure/integrations/qstashClient";
import { enqueueCallDispatchIfScheduled } from "@/server/scheduleCallDispatch";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";

// AUTO-MARCADOR (Alex 27-jun): al cerrar una cita, se programa con QStash que la llamada se dispare SOLA a la
// hora agendada. Aqui se prueba el encolado (forma del publish + dedup) y la guarda de "solo si toca".

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch;
}

const QSTASH_ENV = {
  QSTASH_TOKEN: "qs-token",
  QSTASH_URL: "https://qstash.test",
  CRON_SECRET: "cron-secret"
} as unknown as NodeJS.ProcessEnv;

describe("scheduleCallDispatch (publish a QStash)", () => {
  it("publica con delay, dedup por (candidata, hora) y bearer reenviado", async () => {
    const fetchImpl = okFetch();
    const config = {
      isConfigured: true,
      token: "qs-token",
      url: "https://qstash.test",
      currentSigningKey: "",
      nextSigningKey: "",
      debounceMs: 1,
      debounceEnabled: false
    };
    const ok = await scheduleCallDispatch({
      config,
      dispatchUrl: "https://app.test/api/call/dispatch",
      secret: "cron-secret",
      candidateId: "cand-1",
      scheduledForMs: 1_900_000_000_000,
      delaySeconds: 3600,
      fetchImpl
    });
    expect(ok).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://qstash.test/v2/publish/https://app.test/api/call/dispatch");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Upstash-Delay"]).toBe("3600s");
    expect(headers["Upstash-Forward-Authorization"]).toBe("Bearer cron-secret");
    expect(headers["Upstash-Deduplication-Id"]).toBe("call-dispatch-cand-1-1900000000000");
    expect(headers["Upstash-Retries"]).toBe("0"); // at-most-once: nunca doble-llamada por re-entrega
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      candidateId: "cand-1",
      scheduledForMs: 1_900_000_000_000
    });
  });

  it("sin token o sin secreto -> no publica (false)", async () => {
    const fetchImpl = okFetch();
    const ok = await scheduleCallDispatch({
      config: {
        isConfigured: false,
        token: "",
        url: "https://q",
        currentSigningKey: "",
        nextSigningKey: "",
        debounceMs: 1,
        debounceEnabled: false
      },
      dispatchUrl: "https://app/api/call/dispatch",
      secret: "s",
      candidateId: "c",
      scheduledForMs: 1,
      delaySeconds: 1,
      fetchImpl
    });
    expect(ok).toBe(false);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe("enqueueCallDispatchIfScheduled (cuando encolar)", () => {
  function cand(state: CandidateState, scheduledCallStartMs?: number) {
    return normalizeCandidate({ ...createCandidate({ instagramUsername: "u" }), currentState: state, scheduledCallStartMs });
  }
  const now = 1_000_000_000_000;

  it("CALL_SCHEDULED con hora futura -> encola con el delay correcto", async () => {
    const fetchImpl = okFetch();
    const ok = await enqueueCallDispatchIfScheduled({
      candidate: cand("CALL_SCHEDULED", now + 7200_000),
      origin: "https://app.test/",
      nowMs: now,
      fetchImpl,
      env: QSTASH_ENV
    });
    expect(ok).toBe(true);
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://qstash.test/v2/publish/https://app.test/api/call/dispatch");
    expect(((init as RequestInit).headers as Record<string, string>)["Upstash-Delay"]).toBe("7200s");
  });

  it("estado distinto de CALL_SCHEDULED -> no encola", async () => {
    const fetchImpl = okFetch();
    expect(
      await enqueueCallDispatchIfScheduled({
        candidate: cand("QUALIFYING", now + 1000),
        origin: "https://app",
        nowMs: now,
        fetchImpl,
        env: QSTASH_ENV
      })
    ).toBe(false);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("hora ya pasada o sin hora -> no encola", async () => {
    const fetchImpl = okFetch();
    expect(
      await enqueueCallDispatchIfScheduled({
        candidate: cand("CALL_SCHEDULED", now - 1000),
        origin: "https://app",
        nowMs: now,
        fetchImpl,
        env: QSTASH_ENV
      })
    ).toBe(false);
    expect(
      await enqueueCallDispatchIfScheduled({
        candidate: cand("CALL_SCHEDULED", undefined),
        origin: "https://app",
        nowMs: now,
        fetchImpl,
        env: QSTASH_ENV
      })
    ).toBe(false);
  });

  it("sin QSTASH_TOKEN o sin CRON_SECRET -> no encola", async () => {
    const fetchImpl = okFetch();
    expect(
      await enqueueCallDispatchIfScheduled({
        candidate: cand("CALL_SCHEDULED", now + 1000),
        origin: "https://app",
        nowMs: now,
        fetchImpl,
        env: { CRON_SECRET: "s" } as unknown as NodeJS.ProcessEnv
      })
    ).toBe(false);
    expect(
      await enqueueCallDispatchIfScheduled({
        candidate: cand("CALL_SCHEDULED", now + 1000),
        origin: "https://app",
        nowMs: now,
        fetchImpl,
        env: { QSTASH_TOKEN: "t" } as unknown as NodeJS.ProcessEnv
      })
    ).toBe(false);
  });
});
