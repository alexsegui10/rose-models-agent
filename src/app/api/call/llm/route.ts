import { handleCallLlmRequest } from "@/server/callLlmHandler";

// Endpoint "Custom LLM" OpenAI-compatible. Tambien disponible en /api/call/llm/chat/completions (ElevenLabs
// añade /chat/completions a la URL base). Node runtime: usamos crypto y streaming SSE.
export const runtime = "nodejs";
// Techo de tiempo explicito (Custom LLM en vivo de la llamada): margen si OpenAI tarda; solo sube el limite.
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return handleCallLlmRequest(request);
}
