import type { Candidate } from "@/domain/candidate";
import { getQStashConfig } from "@/application/qstashConfig";
import { scheduleInstantOutreach } from "@/infrastructure/integrations/qstashClient";

/**
 * REAGENDADO INSTANTANEO por Instagram: cuando una llamada agota los 3 intentos sin respuesta (la candidata
 * queda en CALL_NO_ANSWER), en vez de esperar al cron diario de outreach (9h) encolamos con QStash (delay
 * corto) una llamada a /api/call/reschedule-now para que el bot le escriba por IG AL INSTANTE. Best-effort:
 * si QStash/CRON_SECRET no estan configurados o el encolado falla, NO rompe nada — el cron diario sigue
 * cubriendo el reagendado (mismo planOutreach). Devuelve true si se encolo (util para tests/observabilidad).
 *
 * Guard: SOLO para candidatas en CALL_NO_ANSWER (el estado tras agotar los intentos). Si esta en otro estado
 * devuelve false sin encolar (defensa en profundidad; el hook del webhook ya comprueba la condicion completa).
 */
export async function enqueueInstantOutreach(args: {
  candidate: Candidate;
  /** Origen absoluto de la app (new URL(request.url).origin) para construir la URL del callback. */
  origin: string;
  nowMs: number;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const { candidate, origin, fetchImpl } = args;
  const env = args.env ?? process.env;

  if (candidate.currentState !== "CALL_NO_ANSWER") return false;

  const config = getQStashConfig(env);
  const secret = env.CRON_SECRET?.trim() ?? "";
  if (!config.token || !secret) return false;

  try {
    return await scheduleInstantOutreach({
      config,
      rescheduleUrl: `${origin.replace(/\/+$/, "")}/api/call/reschedule-now`,
      secret,
      candidateId: candidate.id,
      delaySeconds: 5,
      fetchImpl
    });
  } catch {
    return false;
  }
}
