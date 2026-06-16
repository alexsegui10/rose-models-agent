import { NextResponse } from "next/server";
import { z } from "zod";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { bearerMatches } from "@/server/bearerAuth";

// Node runtime: usamos crypto (timingSafeEqual) y streaming SSE; el comportamiento debe ser el de Node.
export const runtime = "nodejs";

// Tope defensivo de mensajes a procesar (un turno real es muy corto; protege el replay O(n)).
const MAX_MESSAGES = 200;

/**
 * Endpoint "Custom LLM" OpenAI-compatible que llamará la plataforma de voz (ElevenLabs/Vapi/Retell) en
 * cada turno de la llamada. Es FINO (regla ui-api): autentica, valida, delega en `respondToCall`
 * (application) y formatea la respuesta estilo OpenAI. La lógica del guion vive en el cerebro de la
 * llamada, no aquí.
 *
 * Seguridad: protegido por un bearer token (CALL_LLM_API_KEY). Sin él configurado, responde 503.
 */

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

export async function POST(request: Request) {
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

  const result = respondToCall({ messages, candidateName, recorded });

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

/** Respuesta en streaming SSE en formato OpenAI (un chunk con el texto + chunk de cierre + [DONE]). */
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
      // Formato OpenAI: primer chunk solo el role, luego el contenido, luego el cierre (máxima compatibilidad).
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
