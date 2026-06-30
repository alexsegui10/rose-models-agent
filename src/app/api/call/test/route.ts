import { NextResponse } from "next/server";
import { z } from "zod";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { getElevenLabsOutboundConfig, startOutboundSipCall } from "@/infrastructure/integrations/elevenLabsOutbound";

export const runtime = "nodejs";

/**
 * LLAMADA DE PRUEBA: dispara una llamada saliente por teléfono (SIP/Zadarma) al numero que Alex teclea, SIN tener que simular
 * toda la conversacion ni crear una candidata real. Util para probar la voz una y otra vez. Usa una candidata
 * SINTETICA (no se guarda en el repositorio). Detras del Basic Auth del CRM (solo Alex; no esta en MACHINE_PATHS),
 * y exige las claves de ElevenLabs (si faltan -> 503, asi Alex sabe que tiene que configurarlas).
 */
const BodySchema = z.object({ phone: z.string().min(6) });

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Falta un numero de telefono valido." }, { status: 400 });
  }

  const config = getElevenLabsOutboundConfig();
  if (!config.isConfigured) {
    // Lista EXACTA de las variables que faltan en Vercel (solo nombres, nunca valores). Asi Alex sabe que poner.
    const required: [string, string][] = [
      ["ELEVENLABS_API_KEY", config.apiKey],
      ["ELEVENLABS_AGENT_ID", config.agentId],
      ["ELEVENLABS_AGENT_PHONE_NUMBER_ID", config.agentPhoneNumberId]
    ];
    const missing = required.filter(([, value]) => !value?.trim()).map(([name]) => name);
    return NextResponse.json(
      { ok: false, error: `Faltan en Vercel: ${missing.join(", ")} (anadelas y haz Redeploy).` },
      { status: 503 }
    );
  }

  // Candidata sintetica SOLO para la prueba: nombre "Prueba" + el numero tecleado. No se persiste.
  const testCandidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "__prueba_llamada__" }),
    firstName: "Prueba",
    phone: parsed.data.phone
  });

  const result = await startOutboundSipCall(testCandidate, config);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.reason ?? "No se pudo iniciar la llamada." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, conversationId: result.conversationId ?? null });
}
