import { NextResponse } from "next/server";
import { getWhatsAppConfig } from "@/application/whatsappConfig";
import { parseWhatsAppWebhookEvent } from "@/application/whatsappWebhook";
import { resolveWebhookChallenge, secretFingerprint, verifyWebhookSignature } from "@/application/instagramWebhook";
import { getSimulatorEngine } from "@/server/simulatorStore";

/**
 * Webhook de WhatsApp (Cloud API de Meta). GET = handshake de verificacion. POST = mensajes entrantes:
 * verifica firma -> parsea -> GUARDA (sin responder; el bot NO auto-responde por WhatsApp, decision de
 * Alex) -> 200. La firma y el handshake son los mismos de Meta que en Instagram (utilidades reutilizadas).
 * Idempotente por wamid. Protegido aparte (esta ruta esta en MACHINE_PATHS del middleware: Meta la llama,
 * no el navegador). Si la integracion no esta configurada, responde 200 sin procesar (no rompe nada).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request): Promise<NextResponse> {
  const config = getWhatsAppConfig();
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
  const config = getWhatsAppConfig();
  const buf = Buffer.from(await request.arrayBuffer());
  const rawBody = buf.toString("utf8");
  console.log("[wsp-webhook] POST recibido", { configured: config.isConfigured });

  if (!config.isConfigured) {
    return NextResponse.json({ ok: true, skipped: "not-configured" });
  }

  const sigHeader = request.headers.get("x-hub-signature-256");
  const check = verifyWebhookSignature(buf, sigHeader, config.appSecretCandidates);
  if (!check.valid) {
    // Ni el secreto ni el cuerpo se filtran: solo longitudes y huellas no reversibles (invariante 5).
    console.warn("[wsp-webhook] SKIP firma invalida", {
      headerPresente: Boolean(sigHeader),
      bodyByteLen: buf.byteLength,
      secretFingerprints: config.appSecretCandidates.map(secretFingerprint)
    });
    return new NextResponse("Invalid signature", { status: 403 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid-json" });
  }

  const inbound = parseWhatsAppWebhookEvent(parsed);
  console.log("[wsp-webhook] parseado", { mensajes: inbound.length });
  if (inbound.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no-messages" });
  }

  // Agrupar por remitente para crear/buscar la candidata una sola vez por numero.
  const byPhone = new Map<string, Array<{ content: string; externalMessageId?: string }>>();
  for (const message of inbound) {
    const content = message.text || (message.attachment ? `[adjunto: ${message.attachment.type}]` : "");
    if (!content) continue;
    const list = byPhone.get(message.senderId) ?? [];
    list.push({ content, externalMessageId: message.messageId });
    byPhone.set(message.senderId, list);
  }

  const engine = getSimulatorEngine();
  try {
    for (const [phone, messages] of byPhone) {
      const result = await engine.recordWhatsAppInbound({ phone, messages });
      console.log("[wsp-webhook] guardado (sin responder)", { stored: result.stored });
    }
  } catch (error) {
    console.error("[wsp-webhook] ERROR guardando", {
      message: error instanceof Error ? error.message : String(error)
    });
    // 503 para que Meta REINTENTE ante un fallo (DB/red); la idempotencia por wamid evita duplicar.
    return new NextResponse("Transient processing error, please retry", { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
