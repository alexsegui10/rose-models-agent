import { NextResponse } from "next/server";
import { getInstagramConfig } from "@/application/instagramConfig";
import {
  parseInstagramWebhookEvent,
  resolveWebhookChallenge,
  secretFingerprint,
  verifyWebhookSignature
} from "@/application/instagramWebhook";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { getSimulatorEngine } from "@/server/simulatorStore";

// postgres.js necesita runtime Node (no Edge). maxDuration: en Hobby el techo real es 10s igualmente.
export const runtime = "nodejs";
export const maxDuration = 60;

// Ritmo de la rafaga (peticion de Alex: que no responda al instante y deje unos segundos entre
// mensajes). PRESUPUESTO total de pausa por turno: tope para convivir con el limite de 10s del plan
// gratis (la comprension+redaccion de OpenAI ya consume parte). Ajustable por env si se cambia de plan.
const BURST_DELAY_BUDGET_MS = Number(process.env.INSTAGRAM_BURST_DELAY_BUDGET_MS ?? 4500);
const BURST_DELAY_PER_MESSAGE_MAX_MS = Number(process.env.INSTAGRAM_BURST_DELAY_MAX_MS ?? 2600);

/** Pausa "humana" antes de un mensaje: base + tiempo de tecleo segun longitud, con tope por mensaje. */
function naturalSendDelayMs(chunk: string): number {
  const typingMs = 700 + chunk.trim().length * 28;
  return Math.min(typingMs, BURST_DELAY_PER_MESSAGE_MAX_MS);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Webhook de Instagram. GET = handshake de verificación de Meta. POST = eventos entrantes: verifica
 * firma → parsea → motor → responde (en ráfaga) SOLO si la automatización lo entrega (SENT). En
 * HUMAN_APPROVAL o con la candidata pausada, el motor NO marca SENT y el bot no envía solo (Alex decide
 * en el CRM). Idempotente por mid. Logs `[ig-webhook]` (sin datos personales) para diagnosticar.
 */

export async function GET(request: Request): Promise<NextResponse> {
  const config = getInstagramConfig();
  const params = new URL(request.url).searchParams;
  const challenge = resolveWebhookChallenge(
    {
      mode: params.get("hub.mode"),
      verifyToken: params.get("hub.verify_token"),
      challenge: params.get("hub.challenge")
    },
    config.verifyToken
  );
  if (challenge === null) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const config = getInstagramConfig();
  // Bytes crudos exactos que firmó Meta (sin round-trip de string); rawBody (utf8) solo para el JSON.parse.
  const buf = Buffer.from(await request.arrayBuffer());
  const rawBody = buf.toString("utf8");
  console.log("[ig-webhook] POST recibido", { configured: config.isConfigured });

  if (!config.isConfigured) {
    console.warn("[ig-webhook] SKIP: integracion no configurada (faltan INSTAGRAM_VERIFY_TOKEN/APP_SECRET/ACCESS_TOKEN en env)");
    return NextResponse.json({ ok: true, skipped: "not-configured" });
  }
  const sigHeader = request.headers.get("x-hub-signature-256");
  const check = verifyWebhookSignature(buf, sigHeader, config.appSecretCandidates);
  if (!check.valid) {
    // DIAGNOSTICO TEMPORAL: ni el secreto ni el cuerpo se filtran — solo longitudes y huellas no reversibles.
    console.warn("[ig-webhook] SKIP firma invalida — DIAG", {
      headerPresente: Boolean(sigHeader),
      recibida: sigHeader ? sigHeader.slice(0, 20) : "-",
      bodyByteLen: buf.byteLength,
      bodyStrLen: rawBody.length,
      contentLength: request.headers.get("content-length"),
      secretFingerprints: config.appSecretCandidates.map(secretFingerprint),
      secretLens: config.appSecretCandidates.map((s) => s.length)
    });
    return new NextResponse("Invalid signature", { status: 403 });
  }
  if (check.matchedIndex > 0) {
    console.warn(
      "[ig-webhook] firma valida con SECRETO ALTERNATIVO (INSTAGRAM_APP_SECRET_ALT). Promueve ese valor a INSTAGRAM_APP_SECRET.",
      { index: check.matchedIndex }
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid-json" });
  }

  const inbound = parseInstagramWebhookEvent(parsed);
  console.log("[ig-webhook] parseado", {
    object: describeObject(parsed),
    mensajes: inbound.length,
    eventKeys: describeEventKeys(parsed)
  });
  if (inbound.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no-text-messages" });
  }

  const engine = getSimulatorEngine();
  const provider = new GraphApiInstagramMessagingProvider(config);
  for (const message of inbound) {
    try {
      const result = await engine.handleIncomingTurn({
        // El IGSID es la clave de la conversación (Instagram no da el @username en el webhook).
        instagramUsername: message.senderId,
        messages: [{ content: message.text, externalMessageId: message.messageId }]
      });
      console.log("[ig-webhook] turno procesado", {
        estado: result.candidate.currentState,
        delivery: result.deliveryStatus,
        blocked: result.automationBlocked,
        responseLen: result.response.trim().length
      });
      if (result.deliveryStatus === "SENT" && !result.automationBlocked && result.response.trim().length > 0) {
        const chunks = splitIntoMessageBurst(result.response);
        let delayBudgetMs = BURST_DELAY_BUDGET_MS;
        for (let i = 0; i < chunks.length; i += 1) {
          // Ritmo natural (peticion de Alex): unos segundos entre mensajes, NUNCA instantaneo. Se
          // reparte un presupuesto total de pausa para no acercarse al limite de 10s de Vercel: si se
          // agota, los ultimos mensajes salen seguidos en vez de tumbar la funcion.
          if (delayBudgetMs > 0) {
            const wait = Math.min(naturalSendDelayMs(chunks[i]), delayBudgetMs);
            delayBudgetMs -= wait;
            await sleep(wait);
          }
          const sent = await provider.sendTextMessage(message.senderId, chunks[i]);
          console.log("[ig-webhook] envio a Instagram", { sent, parte: `${i + 1}/${chunks.length}` });
        }
      } else {
        console.log("[ig-webhook] NO se envia respuesta", {
          motivo: `delivery=${result.deliveryStatus} blocked=${result.automationBlocked}`
        });
      }
    } catch (error) {
      console.error("[ig-webhook] ERROR procesando el turno", {
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Solo estructura (no contenido), para diagnosticar sin filtrar datos personales. */
function describeObject(parsed: unknown): string {
  if (parsed && typeof parsed === "object" && "object" in parsed) {
    return String((parsed as { object?: unknown }).object);
  }
  return "?";
}

function describeEventKeys(parsed: unknown): string {
  try {
    const entry = (parsed as { entry?: unknown[] }).entry?.[0] as Record<string, unknown> | undefined;
    if (!entry) return "sin-entry";
    const topKeys = Object.keys(entry).join(",");
    const messagingEvent = (entry.messaging as Record<string, unknown>[] | undefined)?.[0];
    const eventKeys = messagingEvent ? Object.keys(messagingEvent).join(",") : "sin-messaging";
    const messageKeys =
      messagingEvent && messagingEvent.message && typeof messagingEvent.message === "object"
        ? Object.keys(messagingEvent.message as Record<string, unknown>).join(",")
        : "sin-message";
    return `entry[${topKeys}] event[${eventKeys}] message[${messageKeys}]`;
  } catch {
    return "?";
  }
}
