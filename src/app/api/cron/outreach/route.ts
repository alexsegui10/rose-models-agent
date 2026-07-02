import { NextResponse } from "next/server";
import { recoverStuckCalls } from "@/application/callWatchdog";
import { getInstagramConfig } from "@/application/instagramConfig";
import { planOutreach, REENGAGE_TRIGGER, RESCHEDULE_TRIGGER } from "@/application/outreachPlanner";
import { getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";
import { createTransition } from "@/domain/stateMachine";
import type { Candidate } from "@/domain/candidate";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import type { CandidateRepository } from "@/infrastructure/repositories/types";
import { bearerMatches } from "@/server/bearerAuth";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Cron de RE-ENGANCHE proactivo + REAGENDAR. Lo dispara Vercel Cron (ver vercel.json) con el header
 * `Authorization: Bearer <CRON_SECRET>`. Barre las candidatas inactivas, decide de forma DETERMINISTA
 * (planOutreach) si conviene un toque de re-enganche o reabrir el agendado, y si procede envia por IG y
 * persiste lo ocurrido. La IA NO interviene: los mensajes son deterministas (trazados como tales).
 *
 * Seguridad: 503 si no hay CRON_SECRET; 401 si el bearer no coincide. Sin Instagram configurado es no-op.
 * Tope de candidatas por ejecucion + try/catch por candidata (una que falle no rompe el resto). Logs sin
 * datos personales (solo el id interno de candidata y contadores).
 */

export const runtime = "nodejs";

// Inactividad minima para considerar el re-enganche (~20h). El planner reafirma sus propias ventanas.
const IDLE_THRESHOLD_MS = 20 * 60 * 60 * 1000;
// Tope por ejecucion: el cron de Vercel Hobby tiene techo de tiempo; preferimos no barrer todo de golpe.
const MAX_CANDIDATES_PER_RUN = 50;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // WATCHDOG de llamadas atascadas (A1 jul-2026): ANTES del gate de Instagram (no lo necesita). Si el
  // webhook de fin nunca llegó, la candidata quedaba "en curso" para siempre; aquí se re-arma y se avisa.
  let watchdogRecovered = 0;
  try {
    const notifier = getOperatorNotifier();
    const recovered = await recoverStuckCalls({
      repository: getSimulatorRepository(),
      notify: (r) =>
        notifier.notify({ kind: "call-watchdog", conversationId: r.instagramUsername, detail: `${r.minutesStuck} min en curso.` })
    });
    watchdogRecovered = recovered.length;
  } catch (error) {
    console.error("[cron-outreach] watchdog de llamadas fallo (continuamos)", { error: errorName(error) });
  }

  const config = getInstagramConfig();
  if (!config.isConfigured) {
    console.warn("[cron-outreach] SKIP: Instagram no configurado (no-op)");
    return NextResponse.json({ ok: true, skipped: "instagram-not-configured", watchdogRecovered });
  }

  const repository = getSimulatorRepository();
  const provider = new GraphApiInstagramMessagingProvider(config);
  const now = new Date();

  let candidates: Candidate[] = [];
  try {
    candidates = await repository.listCandidatesForOutreach(now.getTime() - IDLE_THRESHOLD_MS);
  } catch (error) {
    console.error("[cron-outreach] error listando candidatas", { error: errorName(error) });
    return NextResponse.json({ error: "listing failed" }, { status: 500 });
  }

  const batch = candidates.slice(0, MAX_CANDIDATES_PER_RUN);
  let reengaged = 0;
  let rescheduled = 0;
  let cooled = 0;
  let failed = 0;

  for (const candidate of batch) {
    try {
      const recentMessages = await repository.listMessages(candidate.id);
      const plan = planOutreach({ candidate, recentMessages, now });
      if (!plan) continue;

      const trigger = plan.kind === "reschedule" ? RESCHEDULE_TRIGGER : REENGAGE_TRIGGER;
      const sent = await provider.sendTextMessage(candidate.instagramUsername, plan.message, {
        humanAgentTag: plan.humanAgentTag
      });
      if (!sent) {
        console.warn("[cron-outreach] envio rechazado/no enviado", { candidateId: candidate.id, kind: plan.kind });
        continue;
      }

      // Mensaje de agente con traza HONESTA: lo redacto codigo determinista, no la IA (invariante 6).
      await repository.addMessage({
        id: crypto.randomUUID(),
        candidateId: candidate.id,
        role: "agent",
        author: "AI_AGENT",
        content: plan.message,
        createdAt: new Date(),
        metadata: { provider: "deterministic", trigger, proactive: true, humanAgentTag: plan.humanAgentTag }
      });

      await applyOutcome(repository, candidate, plan, now);

      if (plan.kind === "reschedule") rescheduled += 1;
      else if (plan.markCold) cooled += 1;
      else reengaged += 1;
    } catch (error) {
      // Una candidata que falle (BD/red) no debe abortar el resto del barrido.
      failed += 1;
      console.error("[cron-outreach] error procesando candidata", { candidateId: candidate.id, error: errorName(error) });
    }
  }

  console.log("[cron-outreach] barrido completado", {
    consideradas: candidates.length,
    procesadas: batch.length,
    reengaged,
    rescheduled,
    cooled,
    failed
  });
  return NextResponse.json({
    ok: true,
    considered: candidates.length,
    reengaged,
    rescheduled,
    cooled,
    failed,
    watchdogRecovered
  });
}

/**
 * Aplica el efecto de estado del plan: reschedule -> transicion a COLLECTING_CALL_DETAILS; markCold ->
 * deja una NOTA COLD_NO_RESPONSE SIN cambiar a estado terminal (no se cierra a malas). El toque 1 de
 * re-enganche no cambia estado (solo se envia el mensaje, ya persistido arriba).
 */
async function applyOutcome(
  repository: CandidateRepository,
  candidate: Candidate,
  plan: ReturnType<typeof planOutreach>,
  now: Date
): Promise<void> {
  if (!plan) return;

  if (plan.transitionTo && plan.transitionTo !== candidate.currentState) {
    const transition = createTransition({
      candidate,
      toState: plan.transitionTo,
      trigger: RESCHEDULE_TRIGGER,
      reason: "Re-enganche: reabrir el agendado tras 3 llamadas sin respuesta."
    });
    await repository.saveCandidate({ ...candidate, currentState: plan.transitionTo, updatedAt: now });
    await repository.addTransition(transition);
    return;
  }

  if (plan.markCold) {
    // Frio: NO cerrar. Solo dejar constancia para que Alex lo vea en el CRM.
    const note = `COLD_NO_RESPONSE: sin respuesta tras 2 toques de re-enganche (${now.toISOString()}).`;
    await repository.saveCandidate({ ...candidate, notes: [...candidate.notes, note], updatedAt: now });
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

// Vercel Cron dispara el trabajo con una peticion GET al `path` de vercel.json (no POST). Exponemos GET
// con la MISMA logica (mismo bearer CRON_SECRET) para que el cron arranque de verdad en produccion; POST
// se mantiene para disparo manual/pruebas.
export const GET = POST;
