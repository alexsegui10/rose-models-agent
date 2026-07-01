import { NextResponse } from "next/server";
import { z } from "zod";
import { respondToCall, type CallChatMessage, type RespondToCallInput } from "@/application/callTurnResponder";
import type { CallContext } from "@/application/callContext";
import { getCallDrafter } from "@/application/openaiCallDrafter";
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

// Contexto de la candidata (del DM) que llega como variable dinámica de la plataforma de voz.
const ContextSchema = z
  .object({
    candidateName: z.string().optional(),
    age: z.number().optional(),
    country: z.string().optional(),
    hasOnlyFans: z.boolean().optional(),
    worksWithAnotherAgency: z.boolean().optional(),
    scheduledSlot: z.string().optional(),
    dmSummary: z.string().optional(),
    concerns: z.array(z.string()).optional(),
    interestLevel: z.string().optional()
  })
  .passthrough();

const MetaSchema = z
  .object({
    candidateName: z.string().optional(),
    recorded: z.boolean().optional(),
    context: ContextSchema.optional()
  })
  .passthrough();

const RequestSchema = z
  .object({
    messages: z.array(MessageSchema).default([]),
    model: z.string().optional(),
    stream: z.boolean().optional(),
    // ElevenLabs inyecta las variables dinámicas en `elevenlabs_extra_body`; otras plataformas usan
    // `call_metadata`. Aceptamos ambos (el primero que venga).
    elevenlabs_extra_body: MetaSchema.optional(),
    call_metadata: MetaSchema.optional()
  })
  .passthrough();

// Coerciones para variables dinámicas PLANAS (ElevenLabs las manda como string/number/boolean).
function asMetaString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
function asMetaNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}
function asMetaBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

// Construye el contexto del DM desde variables dinámicas PLANAS en snake_case (las que envía el disparador
// outbound). Devuelve undefined si no hay ninguna, para no fabricar un contexto vacío.
export function contextFromFlatVars(raw: Record<string, unknown>): CallContext | undefined {
  const concernsRaw = raw.concerns;
  const concerns =
    typeof concernsRaw === "string"
      ? concernsRaw
          .split(/[;\n]/)
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
      : Array.isArray(concernsRaw)
        ? concernsRaw.filter((c): c is string => typeof c === "string")
        : [];
  const context = {
    candidateName: asMetaString(raw.candidate_name),
    age: asMetaNumber(raw.age),
    country: asMetaString(raw.country),
    hasOnlyFans: asMetaBool(raw.has_onlyfans),
    worksWithAnotherAgency: asMetaBool(raw.works_with_another_agency),
    scheduledSlot: asMetaString(raw.scheduled_slot),
    dmSummary: asMetaString(raw.dm_summary),
    interestLevel: asMetaString(raw.interest_level),
    concerns
  };
  const hasAny =
    context.candidateName !== undefined ||
    context.age !== undefined ||
    context.country !== undefined ||
    context.hasOnlyFans !== undefined ||
    context.worksWithAnotherAgency !== undefined ||
    context.scheduledSlot !== undefined ||
    context.dmSummary !== undefined ||
    context.interestLevel !== undefined ||
    concerns.length > 0;
  return hasAny ? context : undefined;
}

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
    // Trunca defensivamente cada mensaje (robustez ante input grande); el redactor no reenvia el crudo.
    .map((m) => ({ role: m.role as CallChatMessage["role"], content: (m.content ?? "").slice(0, 4000) }));

  // ElevenLabs manda las variables dinámicas en elevenlabs_extra_body; otras plataformas en call_metadata.
  const meta = parsed.data.elevenlabs_extra_body ?? parsed.data.call_metadata;
  // Aviso de grabación: por defecto NO se anuncia (decisión de Alex jul-2026). La grabación sigue activa en
  // ElevenLabs; solo se deja de mencionar. Reversible: CALL_RECORDED=1 (o meta.recorded=true) reactiva el aviso.
  const recordedEnv = process.env.CALL_RECORDED;
  const recorded = meta?.recorded ?? recordedEnv === "1";
  // El contexto puede venir ANIDADO (meta.context) o PLANO en snake_case (lo que envía nuestro disparador
  // outbound como dynamic_variables). Aceptamos ambos para que el bot SIEMPRE sepa con quién habla.
  const rawMeta = (meta ?? {}) as Record<string, unknown>;
  const nestedContext = meta?.context ? { ...meta.context, concerns: meta.context.concerns ?? [] } : undefined;
  const context = nestedContext ?? contextFromFlatVars(rawMeta);
  const candidateName = meta?.candidateName ?? context?.candidateName ?? asMetaString(rawMeta.candidate_name);

  // Redactor LLM: ACTIVO por defecto con clave (redacción natural); CALL_LLM_REDACTION=off -> guion fijo.
  const drafter = getCallDrafter();
  const respondInput: RespondToCallInput = { messages, candidateName, recorded, context, drafter };

  const model = parsed.data.model ?? "rose-models-call-brain";
  const created = Math.floor(Date.now() / 1000);
  const id = `chatcmpl-call-${created}`;

  if (parsed.data.stream) {
    return streamCallResponse({ id, created, model, respondInput });
  }

  try {
    const result = await respondToCall(respondInput);
    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: result.content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  } catch (error) {
    // La llamada está EN VIVO: nunca un 500 que deje al bot mudo. Frase segura y a seguir.
    console.error("[call-llm] fallo del cerebro (no-stream)", {
      message: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [{ index: 0, message: { role: "assistant", content: SAFE_RETRY_TEXT }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    });
  }
}

// Frase segura si el cerebro falla a mitad de llamada: no inventa nada y devuelve el turno a la candidata.
const SAFE_RETRY_TEXT = "Perdona, se me ha cortado un segundo la línea. ¿Me lo repites?";

/**
 * Respuesta en streaming SSE en formato OpenAI, con "BUFFER WORDS" (jul-2026): el cerebro corre DENTRO del
 * stream y, justo antes de la única espera lenta (el redactor LLM), emite una muletilla corta ("Vale... ")
 * para que la voz ya esté hablando mientras se redacta — mata el silencio que delata al bot. Los caminos
 * deterministas no emiten muletilla (son instantáneos). CALL_BUFFER_WORDS=off la desactiva.
 */
function streamCallResponse(args: { id: string; created: number; model: string; respondInput: RespondToCallInput }): Response {
  const encoder = new TextEncoder();
  const chunk = (delta: object, finishReason: string | null) =>
    `data: ${JSON.stringify({
      id: args.id,
      object: "chat.completion.chunk",
      created: args.created,
      model: args.model,
      choices: [{ index: 0, delta, finish_reason: finishReason }]
    })}\n\n`;

  const bufferWordsEnabled = process.env.CALL_BUFFER_WORDS !== "off";

  const stream = new ReadableStream({
    async start(controller) {
      const send = (delta: object, finishReason: string | null) => controller.enqueue(encoder.encode(chunk(delta, finishReason)));
      send({ role: "assistant" }, null);
      try {
        const result = await respondToCall({
          ...args.respondInput,
          onDraftStart: bufferWordsEnabled ? (bufferText) => send({ content: bufferText }, null) : undefined
        });
        send({ content: result.content }, null);
      } catch (error) {
        // Nunca dejar la llamada muda: frase segura (la cabecera 200 ya salió, no hay vuelta atrás).
        console.error("[call-llm] fallo del cerebro (stream)", {
          message: error instanceof Error ? error.message : String(error)
        });
        send({ content: SAFE_RETRY_TEXT }, null);
      }
      send({}, "stop");
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
