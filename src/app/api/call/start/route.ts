import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { getElevenLabsOutboundConfig, startOutboundSipCall } from "@/infrastructure/integrations/elevenLabsOutbound";

export const runtime = "nodejs";

/**
 * Dispara la llamada saliente por teléfono (SIP/Zadarma vía ElevenLabs) a una candidata. Lo llama el CRM
 * de Alex. La llamada suena directamente (sin permiso previo), así que es una acción real con coste.
 */
const BodySchema = z.object({ candidateId: z.string().min(1) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const config = getElevenLabsOutboundConfig();
  if (!config.isConfigured) {
    return NextResponse.json({ error: "ElevenLabs no está configurado (faltan ELEVENLABS_* en Vercel)." }, { status: 503 });
  }

  const repository = getSimulatorRepository();
  const candidate = await repository.findCandidateById(parsed.data.candidateId);
  if (!candidate) {
    return NextResponse.json({ error: "Candidata no encontrada." }, { status: 404 });
  }

  const result = await startOutboundSipCall(candidate, config);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? "No se pudo iniciar la llamada." }, { status: 502 });
  }

  // El contador de intentos se incrementa SOLO cuando la llamada ARRANCÓ de verdad (un 502 al iniciar no
  // gasta intento): así recordCallOutcome solo lo lee para decidir el reintento diferido (hasta 3).
  await getSimulatorEngine().noteCallAttempt(parsed.data.candidateId, result.conversationId ?? undefined);
  return NextResponse.json({ ok: true, conversationId: result.conversationId ?? null });
}
