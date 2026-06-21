/**
 * Cliente server-side para traer la GRABACION de una llamada de ElevenLabs (Conversational AI).
 * La clave (xi-api-key) NUNCA va al navegador: este modulo solo se usa desde el backend (el proxy
 * `/api/call/[conversationId]/audio`). Endpoint oficial: GET /v1/convai/conversations/{id}/audio.
 */

const ELEVENLABS_API_BASE = "https://api.elevenlabs.io";

export interface ElevenLabsConversationAudio {
  ok: boolean;
  status: number;
  body: ReadableStream<Uint8Array> | null;
  contentType: string;
}

/**
 * Trae el audio (mp3) de una conversacion por su id. No lanza: devuelve `ok:false` si falla, para que el
 * proxy responda un error limpio sin filtrar nada.
 */
export async function getConversationAudio(
  conversationId: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<ElevenLabsConversationAudio> {
  const url = `${ELEVENLABS_API_BASE}/v1/convai/conversations/${encodeURIComponent(conversationId)}/audio`;
  try {
    const response = await fetchImpl(url, { headers: { "xi-api-key": apiKey } });
    return {
      ok: response.ok,
      status: response.status,
      body: response.body,
      contentType: response.headers.get("content-type") ?? "audio/mpeg"
    };
  } catch {
    return { ok: false, status: 502, body: null, contentType: "audio/mpeg" };
  }
}
