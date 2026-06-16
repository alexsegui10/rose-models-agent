import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";

/**
 * Webhook de FIN de llamada: lo invoca la plataforma de voz cuando la llamada termina. Ruta fina
 * (regla ui-api): autentica, valida, delega en `engine.recordCallOutcome` y responde. El `candidateId`
 * se pasó como metadato al iniciar la llamada saliente.
 *
 * Protegido por CALL_WEBHOOK_SECRET (bearer). Sin él, responde 503.
 */

const EndCallSchema = z
  .object({
    candidateId: z.string().min(1),
    /** Disposición de la plataforma (answered/completed/no-answer/busy/failed...). */
    status: z.string().min(1),
    /** Resumen/transcripción opcional de la llamada. */
    summary: z.string().optional()
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
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";
  if (token !== secret) {
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
    summary: parsed.data.summary
  });

  return NextResponse.json({
    candidate: result.candidate,
    appliedTransitions: result.transitions,
    outcome
  });
}
