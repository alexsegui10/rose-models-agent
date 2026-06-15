import { after, NextResponse } from "next/server";
import { getInstagramConfig } from "@/application/instagramConfig";
import { parseInstagramWebhookEvent, resolveWebhookChallenge, verifyWebhookSignature } from "@/application/instagramWebhook";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import { getSimulatorEngine } from "@/server/simulatorStore";

// postgres.js necesita runtime Node (no Edge). maxDuration: en Hobby el techo real es 10s igualmente.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Webhook de Instagram (Messenger Platform). GET = handshake de verificación de Meta. POST = eventos
 * entrantes: verifica firma → parsea → motor → responde (en ráfaga) SOLO si la automatización lo
 * entrega (SENT). En HUMAN_APPROVAL o con la candidata pausada en el CRM, el motor NO marca SENT, así
 * que el bot no envía nada solo: Alex decide desde el CRM. La idempotencia por mid (externalMessageId)
 * evita procesar dos veces si Meta reintenta. Nunca se procesa un POST sin firma válida.
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

  // Sin configuración no se procesa, pero se responde 200 para que Meta no reintente en bucle.
  if (!config.isConfigured) {
    return NextResponse.json({ ok: true, skipped: "not-configured" });
  }
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"), config.appSecret)) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid-json" });
  }

  const inbound = parseInstagramWebhookEvent(parsed);
  if (inbound.length > 0) {
    // Se responde 200 a Meta YA y se procesa en `after()` (tras enviar la respuesta), para que el ACK
    // sea rapido (Meta reintenta ante cualquier no-200) y el motor + envio no bloqueen el handshake.
    after(async () => {
      const engine = getSimulatorEngine();
      const provider = new GraphApiInstagramMessagingProvider(config);
      for (const message of inbound) {
        try {
          const result = await engine.handleIncomingTurn({
            // El IGSID es la clave de la conversación (Instagram no da el @username en el webhook).
            instagramUsername: message.senderId,
            messages: [{ content: message.text, externalMessageId: message.messageId }]
          });
          // Solo se envía si la automatización LO ENTREGA. PENDING_APPROVAL/BLOCKED → Alex decide en el CRM.
          if (result.deliveryStatus === "SENT" && !result.automationBlocked && result.response.trim().length > 0) {
            for (const chunk of splitIntoMessageBurst(result.response)) {
              await provider.sendTextMessage(message.senderId, chunk);
            }
          }
        } catch (error) {
          console.warn("[instagram] error procesando un mensaje entrante", {
            error: error instanceof Error ? error.name : "unknown"
          });
        }
      }
    });
  }

  // Siempre 200 tras verificar: Meta reintenta ante cualquier no-200 (la idempotencia cubre el reintento).
  return NextResponse.json({ ok: true });
}
