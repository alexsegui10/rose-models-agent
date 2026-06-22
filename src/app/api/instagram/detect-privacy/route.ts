import { NextResponse } from "next/server";
import { z } from "zod";
import { getInstagramConfig } from "@/application/instagramConfig";
import { fetchInstagramProfile, instagramProfileUrl } from "@/infrastructure/integrations/instagramProfileProvider";
import { fetchInstagramIsPrivate } from "@/infrastructure/integrations/instagramPrivacyProvider";
import { getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";
import { getSimulatorRepository } from "@/server/simulatorStore";
import { bearerMatches } from "@/server/bearerAuth";

/**
 * POST /api/instagram/detect-privacy — detección de privada/pública EN SEGUNDO PLANO. La dispara el webhook
 * (vía QStash) tras enviar el saludo público, para NO bloquear la entrega: Apify tarda varios segundos y en
 * el camino del primer mensaje se comía el techo de ~10s de Vercel. Aquí corre en una invocación aparte.
 *
 * Si la cuenta es PRIVADA, AVISA a Alex por WhatsApp para que le envíe él la solicitud de seguimiento
 * (Instagram no permite enviarla por API). NO muta el estado de la candidata (para no disparar transiciones
 * a media conversación): solo avisa. La visibilidad para el CRM la resuelve aparte /api/instagram/profile.
 * Best-effort: cualquier fallo es silencioso (el saludo ya salió; el CRM sigue mostrando privada al abrir).
 *
 * Auth: QStash reenvía `Authorization: Bearer <CRON_SECRET>`. En MACHINE_PATHS del middleware.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({ senderId: z.string().min(1) });

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "detect-privacy not configured" }, { status: 503 });
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
  try {
    // La candidata debe existir (no avisamos de un IGSID que no es candidata real). No la mutamos.
    const candidate = await getSimulatorRepository().findCandidateByInstagram(senderId);
    if (!candidate) {
      return NextResponse.json({ ok: true, skipped: "not-found" });
    }

    const config = getInstagramConfig();
    const profile = await fetchInstagramProfile(senderId, config);
    const isPrivate = await fetchInstagramIsPrivate(profile?.username);

    if (isPrivate === true) {
      // El saludo público ya salió, así que el bot NO le ha pedido aún que acepte: botAskedToAccept=false.
      await getOperatorNotifier().notify({
        kind: "follow-request",
        conversationId: senderId,
        profileUrl: instagramProfileUrl(profile?.username) ?? undefined,
        botAskedToAccept: false
      });
    }
    return NextResponse.json({ ok: true, detected: isPrivate });
  } catch (error) {
    console.error("[ig-detect-privacy] ERROR", { message: error instanceof Error ? error.message : String(error) });
    // 503 -> QStash reintenta (best-effort; un fallo no debe dejar rastro de error visible al usuario).
    return new NextResponse("Transient error", { status: 503 });
  }
}
