import { NextResponse } from "next/server";
import { z } from "zod";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { getElevenLabsOutboundConfig, startOutboundSipCall } from "@/infrastructure/integrations/elevenLabsOutbound";

export const runtime = "nodejs";
// 60s (3-jul): el camino síncrono (Neon fría + ElevenLabs + escrituras) superaba el techo por defecto de
// ~10s y la lambda moría a MEDIAS (llamada sonando sin registrar). Con 60s hay margen de sobra.
export const maxDuration = 60;

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
  // Fallo LIMPIO (ElevenLabs respondió que NO): la llamada seguro que no salió -> 502 sin gastar intento.
  if (!result.ok && !result.indeterminate) {
    return NextResponse.json({ error: result.reason ?? "No se pudo iniciar la llamada." }, { status: 502 });
  }

  // OK o resultado DESCONOCIDO (timeout/red con la llamada posiblemente sonando, 3-jul): se registra el
  // intento IGUAL — así callAttempts y CALL_IN_PROGRESS reflejan el mundo real y el tope de 3 y la guarda
  // anti-doble-llamada son fiables. Si en realidad no salió, el watchdog (20 min) la re-arma solo.
  await getSimulatorEngine().noteCallAttempt(parsed.data.candidateId, result.conversationId ?? undefined);
  if (!result.ok) {
    console.warn("[call-start] llamada disparada SIN confirmación de ElevenLabs (se registra igual)", {
      candidateId: parsed.data.candidateId,
      reason: result.reason ?? "desconocido"
    });
  }
  return NextResponse.json({ ok: true, conversationId: result.conversationId ?? null, unconfirmed: !result.ok });
}
