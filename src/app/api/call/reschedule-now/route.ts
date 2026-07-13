import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstagramConfig } from "@/application/instagramConfig";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { bearerMatches } from "@/server/bearerAuth";
import { processOutreachForCandidate } from "@/server/outreachDelivery";
import { getSimulatorRepository } from "@/server/simulatorStore";

/**
 * REAGENDADO INSTANTANEO por Instagram. Lo dispara QStash (encolado por el webhook de fin de llamada cuando se
 * agotan los 3 intentos sin respuesta) con un delay corto, reenviando `Authorization: Bearer <CRON_SECRET>`.
 * A diferencia del cron diario, NO barre a todas las candidatas ni aplica el filtro de inactividad de 20h:
 * reagenda SOLO a la candidata del `candidateId`, al instante. La DECISION (si escribir, que escribir) sigue
 * siendo determinista (planOutreach, reusado via processOutreachForCandidate); la IA NO interviene.
 *
 * Idempotente: si ya se reagendo (mensaje con trigger RESCHEDULE_CALL en el historial), planOutreach devuelve
 * null y no se reenvia. Respeta la pausa de Alex (manualControlActive/automationPaused -> planOutreach = null).
 *
 * Seguridad: 503 si no hay CRON_SECRET; 401 si el bearer no coincide (mismo patron que el cron). Sin Instagram
 * configurado es no-op (200 skipped). Try/catch global -> 500 con log sin datos personales.
 */

export const runtime = "nodejs";

const BodySchema = z.object({ candidateId: z.string().min(1) });

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let candidateId: string;
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "candidateId requerido" }, { status: 400 });
    }
    candidateId = parsed.data.candidateId;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  try {
    const config = getInstagramConfig();
    if (!config.isConfigured) {
      console.warn("[reschedule-now] SKIP: Instagram no configurado (no-op)");
      return NextResponse.json({ ok: true, skipped: "instagram-not-configured" });
    }

    const repository = getSimulatorRepository();
    const provider = new GraphApiInstagramMessagingProvider(config);
    const now = new Date();

    const candidate = await repository.findCandidateById(candidateId);
    if (!candidate) {
      console.warn("[reschedule-now] candidata desconocida: se ignora sin error", { candidateId });
      return NextResponse.json({ ok: true, skipped: "not-found" });
    }

    const recentMessages = await repository.listMessages(candidate.id);
    const result = await processOutreachForCandidate({ repository, provider, candidate, recentMessages, now });

    console.log("[reschedule-now] procesado", { candidateId: candidate.id, result });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[reschedule-now] error procesando reagendado instantaneo", {
      error: error instanceof Error ? error.name : "unknown"
    });
    return NextResponse.json({ error: "reschedule failed" }, { status: 500 });
  }
}
