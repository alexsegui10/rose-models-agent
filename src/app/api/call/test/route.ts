import { NextResponse } from "next/server";
import { z } from "zod";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { getElevenLabsOutboundConfig, startOutboundSipCall } from "@/infrastructure/integrations/elevenLabsOutbound";
import { sameOriginAllowed } from "@/application/sameOrigin";

export const runtime = "nodejs";

/**
 * LLAMADA DE PRUEBA: dispara una llamada saliente por teléfono (SIP/Zadarma) al numero que Alex teclea, SIN tener que simular
 * toda la conversacion ni crear una candidata real. Util para probar la voz una y otra vez. Usa una candidata
 * SINTETICA (no se guarda en el repositorio). Exige las claves de ElevenLabs (si faltan -> 503, asi Alex sabe
 * que tiene que configurarlas).
 *
 * SEGURIDAD (jul-2026): tras quitar el candado global de contraseña, este endpoint dispara llamadas de PAGO a
 * cualquier numero. Guardia "mismo origen": solo se acepta desde la propia web del CRM, para que un desconocido
 * no pueda usar el sistema como rele de llamadas (coste + acoso a terceros). No añade fricción a Alex.
 */
const BodySchema = z.object({ phone: z.string().min(6) });

export async function POST(request: Request) {
  if (!sameOriginAllowed(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  }
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
