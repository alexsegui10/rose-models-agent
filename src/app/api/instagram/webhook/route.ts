import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { getInstagramConfig } from "@/application/instagramConfig";
import { parseInstagramWebhookEvent, resolveWebhookChallenge, verifyWebhookSignature } from "@/application/instagramWebhook";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { getSimulatorEngine } from "@/server/simulatorStore";

// postgres.js necesita runtime Node (no Edge). maxDuration: en Hobby el techo real es 10s igualmente.
export const runtime = "nodejs";
export const maxDuration = 60;

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
  const rawBody = await request.text();
  console.log("[ig-webhook] POST recibido", { configured: config.isConfigured });

  if (!config.isConfigured) {
    console.warn("[ig-webhook] SKIP: integracion no configurada (faltan INSTAGRAM_VERIFY_TOKEN/APP_SECRET/ACCESS_TOKEN en env)");
    return NextResponse.json({ ok: true, skipped: "not-configured" });
  }
  const sigHeader = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBody, sigHeader, config.appSecret)) {
    // DIAGNOSTICO TEMPORAL: solo prefijos de hash (no son secretos) + longitudes, para localizar la causa.
    const calculada = sigHeader
      ? `sha256=${createHmac("sha256", config.appSecret).update(rawBody, "utf8").digest("hex")}`
      : "(sin header)";
    console.warn("[ig-webhook] SKIP firma invalida — DIAG", {
      headerPresente: Boolean(sigHeader),
      recibida: sigHeader ? sigHeader.slice(0, 20) : "-",
      calculada: calculada.slice(0, 20),
      bodyLen: rawBody.length,
      secretLen: config.appSecret.length
    });
    return new NextResponse("Invalid signature", { status: 403 });
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
        for (const chunk of splitIntoMessageBurst(result.response)) {
          const sent = await provider.sendTextMessage(message.senderId, chunk);
          console.log("[ig-webhook] envio a Instagram", { sent });
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
