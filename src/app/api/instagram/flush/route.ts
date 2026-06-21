import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstagramConfig } from "@/application/instagramConfig";
import { getQStashConfig } from "@/application/qstashConfig";
import { GraphApiInstagramMessagingProvider } from "@/infrastructure/integrations/instagramMessagingProvider";
import {
  escalationNotificationFor,
  followRequestNotificationFor,
  getOperatorNotifier
} from "@/infrastructure/integrations/operatorNotifier";
import { fetchInstagramProfile, instagramProfileUrl } from "@/infrastructure/integrations/instagramProfileProvider";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import { getSimulatorEngine } from "@/server/simulatorStore";
import { bearerMatches } from "@/server/bearerAuth";

/**
 * Callback DIFERIDO del debounce (lo invoca QStash ~55s despues de un mensaje). Si la candidata lleva la
 * ventana entera callada, responde a TODA su rafaga pendiente de una vez (flushPendingInbound) y envia la
 * respuesta a Instagram en rafaga. Si sigue dentro de la ventana (escribiendo), no hace nada (otro callback
 * posterior lo hara). Idempotente: tras vaciar, un callback repetido no responde otra vez.
 *
 * Auth: QStash reenvia `Authorization: Bearer <CRON_SECRET>` (lo pusimos en el publish). Solo nosotros
 * conocemos el secreto, asi que nadie mas puede disparar un flush. En MACHINE_PATHS del middleware.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ senderId: z.string().min(1) });

// Tope de tiempo para enviar la rafaga (margen bajo el techo de ~10s de Vercel).
const HARD_DEADLINE_MS = 9000;

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "flush not configured" }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const senderId = parsed.data.senderId;
  const qstash = getQStashConfig();
  const engine = getSimulatorEngine();

  try {
    const result = await engine.flushPendingInbound({ instagramUsername: senderId, windowMs: qstash.debounceMs });
    // null = aun escribiendo (dentro de la ventana) o nada pendiente: no se responde ahora.
    if (!result) {
      return NextResponse.json({ ok: true, flushed: false });
    }

    const config = getInstagramConfig();
    if (
      config.isConfigured &&
      result.deliveryStatus === "SENT" &&
      !result.automationBlocked &&
      result.response.trim().length > 0
    ) {
      const provider = new GraphApiInstagramMessagingProvider(config);
      const chunks = splitIntoMessageBurst(result.response);
      const startedAt = Date.now();
      for (let i = 0; i < chunks.length; i += 1) {
        if (Date.now() - startedAt > HARD_DEADLINE_MS) break;
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(700 + chunks[i].trim().length * 28, 2600)));
        }
        const sent = await provider.sendTextMessage(senderId, chunks[i]);
        if (!sent) break;
      }
    }

    // Paridad con el webhook directo: avisar a Alex por WhatsApp si la candidata ENTRO en revision humana
    // (escalada) o si su cuenta privada necesita que el envie la solicitud. Sin esto, con el debounce ON,
    // Alex se perderia esos avisos. notify() nunca lanza (best-effort).
    const escalation = escalationNotificationFor(result.candidate, result.plannedTransitions);
    const followRequest = followRequestNotificationFor(result.candidate, result.plannedTransitions);
    if (escalation || followRequest) {
      const notifier = getOperatorNotifier();
      const profile = await fetchInstagramProfile(senderId, config);
      const profileUrl = instagramProfileUrl(profile?.username) ?? undefined;
      if (escalation) await notifier.notify({ ...escalation, profileUrl });
      if (followRequest) await notifier.notify({ ...followRequest, profileUrl });
    }
    return NextResponse.json({ ok: true, flushed: true });
  } catch (error) {
    console.error("[ig-flush] ERROR", { message: error instanceof Error ? error.message : String(error) });
    // 503 -> QStash reintenta el callback (idempotente: si ya se vacio, el reintento da flushed:false).
    return new NextResponse("Transient processing error, please retry", { status: 503 });
  }
}
