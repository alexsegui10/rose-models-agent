import { handleCallLlmRequest } from "@/server/callLlmHandler";

// Ruta que usa ElevenLabs Custom LLM: pone la URL base .../api/call/llm y la plataforma añade
// /chat/completions. Mismo handler que /api/call/llm. Node runtime: crypto + streaming SSE.
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleCallLlmRequest(request);
}
