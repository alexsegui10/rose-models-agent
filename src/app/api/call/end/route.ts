import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { bearerMatches } from "@/server/bearerAuth";

/**
 * Webhook de FIN de llamada: lo invoca la plataforma de voz cuando la llamada termina. Ruta fina
 * (regla ui-api): autentica, valida, delega en `engine.recordCallOutcome` y responde. El `candidateId`
 * se pasó como metadato al iniciar la llamada saliente.
 *
 * Protegido por CALL_WEBHOOK_SECRET (bearer). Sin él, responde 503.
 */

export const runtime = "nodejs";

const EndCallSchema = z
  .object({
    candidateId: z.string().min(1),
    /** Disposición de la plataforma (answered/completed/no-answer/busy/failed...). */
    status: z.string().min(1),
    /** Resumen opcional de la llamada (lo genera la plataforma de voz). */
    summary: z.string().optional(),
    /** Duración de la llamada en segundos. */
    durationSec: z.number().int().nonnegative().optional(),
    /** % al que se negoció el reparto para la modelo (lo decidió el código durante la llamada). */
    negotiatedModelShare: z.number().int().min(0).max(100).optional(),
    /** Transcripción turno a turno de la llamada. */
    transcript: z.array(z.object({ role: z.string(), content: z.string() })).optional()
  })
  .passthrough();

// Estados que cuentan como "no contestó" (el resto se trata como completada).
const NO_ANSWER_STATUSES = new Set([
  "no-answer",
  "no_answer",
  "noanswer",
  "busy",
  "failed",
  "missed",
  "unanswered",
  "not-answered",
  "declined",
  "rejected",
  "voicemail",
  "timeout",
  "canceled",
  "cancelled"
]);

function outcomeFromStatus(status: string): "COMPLETED" | "NO_ANSWER" {
  return NO_ANSWER_STATUSES.has(status.trim().toLowerCase()) ? "NO_ANSWER" : "COMPLETED";
}

export async function POST(request: Request) {
  const secret = process.env.CALL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "call webhook not configured" }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = EndCallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const engine = getSimulatorEngine();
  const repository = getSimulatorRepository();
  const existing = await repository.findCandidateById(parsed.data.candidateId);
  if (!existing) {
    return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  }

  const outcome = outcomeFromStatus(parsed.data.status);
  const result = await engine.recordCallOutcome({
    candidateId: parsed.data.candidateId,
    outcome,
    summary: parsed.data.summary,
    durationSec: parsed.data.durationSec,
    negotiatedModelShare: parsed.data.negotiatedModelShare,
    transcript: parsed.data.transcript
  });

  return NextResponse.json({
    candidate: result.candidate,
    appliedTransitions: result.transitions,
    outcome
  });
}
