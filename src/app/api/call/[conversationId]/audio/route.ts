import { NextResponse } from "next/server";
import { getElevenLabsOutboundConfig } from "@/infrastructure/integrations/elevenLabsOutbound";
import { getConversationAudio } from "@/infrastructure/integrations/elevenLabsConversations";

/**
 * Proxy de la GRABACION de una llamada de ElevenLabs. Lo consume el <audio> de la ficha de la candidata.
 * La clave xi-api-key se queda SIEMPRE en el servidor (nunca llega al navegador).
 *
 * OJO (jul-2026): al quitar el candado global de contraseña, esta ruta quedó ABIERTA — cualquiera con la
 * URL de una grabacion (que incluye el conversationId) podria descargarla. No se pone guardia "mismo origen"
 * porque el <audio> la carga como recurso y el navegador no siempre manda Origin en GET de media (romperia
 * la reproduccion). Es datos personales de las candidatas: si se quiere volver a proteger, la via es el
 * candado de contraseña "recordar 30 dias" (o restringir por sesion). Pendiente de decision de Alex.
 */
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ conversationId: string }> }): Promise<Response> {
  const apiKey = getElevenLabsOutboundConfig().apiKey;
  if (!apiKey) {
    return NextResponse.json({ error: "ElevenLabs no configurado (falta ELEVENLABS_API_KEY)." }, { status: 503 });
  }

  const { conversationId } = await params;
  if (!conversationId) {
    return NextResponse.json({ error: "Falta el id de la conversación." }, { status: 400 });
  }

  const audio = await getConversationAudio(conversationId, apiKey);
  if (!audio.ok || !audio.body) {
    return NextResponse.json({ error: "No se pudo obtener la grabación." }, { status: audio.status || 502 });
  }

  return new Response(audio.body, {
    headers: {
      "Content-Type": audio.contentType,
      // Privado: no cachear grabaciones (datos personales) en proxies intermedios.
      "Cache-Control": "private, no-store"
    }
  });
}
