import { NextResponse } from "next/server";
import { z } from "zod";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { bearerMatches } from "@/server/bearerAuth";

/**
 * Handler del endpoint "Custom LLM" OpenAI-compatible que llama la plataforma de voz (ElevenLabs/Vapi/
 * Retell) en cada turno. Vive aquí (no en un route.ts) para exponerse en dos rutas: `/api/call/llm` y
 * `/api/call/llm/chat/completions` (ElevenLabs añade `/chat/completions` a la URL base del servidor).
 *
 * Autentica (bearer CALL_LLM_API_KEY), valida con Zod, delega en `respondToCall` (application) y formatea
 * la respuesta estilo OpenAI (JSON o streaming SSE). La lógica del guion vive en el cerebro, no aquí.
 */

// Tope defensivo de mensajes a procesar (un turno real es muy corto; protege el replay O(n)).
const MAX_MESSAGES = 200;

const MessageSchema = z.object({
  role: z.string(),
  content: z.union([z.string(), z.null()]).optional()
});

const RequestSchema = z
  .object({
    messages: z.array(MessageSchema).default([]),
    model: z.string().optional(),
    stream: z.boolean().optional(),
    // Metadatos opcionales que la plataforma puede inyectar (variables dinámicas).
    call_metadata: z.object({ candidateName: z.string().optional(), recorded: z.boolean().optional() }).optional()
  })
  .passthrough();

export async function handleCallLlmRequest(request: Request): Promise<Response> {
  const apiKey = process.env.CALL_LLM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: { message: "call LLM endpoint not configured", type: "config" } }, { status: 503 });
  }

  if (!bearerMatches(request.headers.get("authorization"), apiKey)) {
    return NextResponse.json({ error: { message: "unauthorized", type: "auth" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { message: "invalid json" } }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const messages: CallChatMessage[] = parsed.data.messages
    .slice(-MAX_MESSAGES)
    .filter((m) => m.role === "system" || m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as CallChatMessage["role"], content: m.content ?? "" }));

  const recordedEnv = process.env.CALL_RECORDED;
  const recorded = parsed.data.call_metadata?.recorded ?? (recordedEnv ? recordedEnv !== "0" : true);
  const candidateName = parsed.data.call_metadata?.candidateName;

  const result = await respondToCall({ messages, candidateName, recorded });

  const model = parsed.data.model ?? "rose-models-call-brain";
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-call-${created}`;

  if (parsed.data.stream) {
    return streamOpenAiResponse({ id, created, model, content: result.content });
  }

  return NextResponse.json({
    id,
    object: "chat.completion",
    created,
    model,
    choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  });
}

/** Respuesta en streaming SSE en formato OpenAI (chunk de role + chunk de contenido + cierre + [DONE]). */
function streamOpenAiResponse(args: { id: string; created: number; model: string; content: string }): Response {
  const encoder = new TextEncoder();
  const chunk = (delta: object, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id: args.id,
      object: "chat.completion.chunk",
      created: args.created,
      model: args.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk({ role: "assistant" }, null)));
      controller.enqueue(encoder.encode(chunk({ content: args.content }, null)));
      controller.enqueue(encoder.encode(chunk({}, "stop")));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Evita el buffering del proxy (importante para streaming en vivo).
      "X-Accel-Buffering": "no"
    }
  });
}
