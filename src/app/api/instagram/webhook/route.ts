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
import { escalationNotificationFor, getOperatorNotifier } from "@/infrastructure/integrations/operatorNotifier";
import { getSimulatorEngine } from "@/server/simulatorStore";

// postgres.js necesita runtime Node (no Edge). maxDuration: en Hobby el techo real es 10s igualmente.
export const runtime = "nodejs";
export const maxDuration = 60;

// Ritmo de la rafaga (peticion de Alex: que no responda al instante y deje unos segundos entre
// mensajes). PRESUPUESTO total de pausa por turno: tope para convivir con el limite de 10s del plan
// gratis (la comprension+redaccion de OpenAI ya consume parte). Ajustable por env si se cambia de plan.
const BURST_DELAY_BUDGET_MS = Number(process.env.INSTAGRAM_BURST_DELAY_BUDGET_MS ?? 4500);
const BURST_DELAY_PER_MESSAGE_MAX_MS = Number(process.env.INSTAGRAM_BURST_DELAY_MAX_MS ?? 2600);
// Techo de tiempo por turno: margen de seguridad bajo el limite de ~10s de Vercel Hobby. El presupuesto
// de pausas se calcula como (este techo - tiempo ya gastado por OpenAI), para no provocar timeouts.
const TURN_TIME_BUDGET_MS = Number(process.env.INSTAGRAM_TURN_BUDGET_MS ?? 8500);

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
  // Reloj del turno: el presupuesto de pausas de la rafaga RESTA lo que ya consumio OpenAI, para no
  // acercarse al techo de ~10s del plan Hobby de Vercel (peticion validada en la auditoria 16-jun).
  const turnStartedAt = Date.now();
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
  // Avisos al operador (Alex) por WhatsApp: no-op si no hay claves de CallMeBot en el entorno.
  const notifier = getOperatorNotifier();
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
        // Presupuesto de pausa = lo que queda del techo del turno tras descontar el tiempo ya gastado
        // (sobre todo OpenAI). Si OpenAI tardo mucho, casi no se pausa, en vez de arriesgar el timeout.
        const elapsedMs = Date.now() - turnStartedAt;
        let delayBudgetMs = Math.max(0, Math.min(BURST_DELAY_BUDGET_MS, TURN_TIME_BUDGET_MS - elapsedMs));
        for (let i = 0; i < chunks.length; i += 1) {
          // Ritmo natural (peticion de Alex): unos segundos entre mensajes, NUNCA instantaneo. Se
          // reparte un presupuesto total de pausa para no acercarse al limite de 10s de Vercel: si se
          // agota, los ultimos mensajes salen seguidos en vez de tumbar la funcion.
          if (delayBudgetMs > 0) {
            const wait = Math.min(naturalSendDelayMs(chunks[i]), delayBudgetMs);
            delayBudgetMs -= wait;
            await sleep(wait);
          }
          // sendTextMessage devuelve false (no lanza) si la API rechaza o falla la red. Si un chunk se
          // pierde, ABORTAMOS la rafaga: seguir enviaria los siguientes fuera de orden/contexto (la
          // candidata veria la parte 3 sin la 2). Se deja traza honesta de entrega parcial.
          const sent = await provider.sendTextMessage(message.senderId, chunks[i]);
          console.log("[ig-webhook] envio a Instagram", { sent, parte: `${i + 1}/${chunks.length}` });
          if (!sent) {
            console.warn("[ig-webhook] entrega PARCIAL: chunk fallido, se aborta el resto de la rafaga", {
              enviados: i,
              total: chunks.length
            });
            break;
          }
        }
      } else {
        console.log("[ig-webhook] NO se envia respuesta", {
          motivo: `delivery=${result.deliveryStatus} blocked=${result.automationBlocked}`
        });
      }
      // Aviso al operador SOLO cuando la candidata ENTRA este turno en revision humana (escalada), no en
      // cada turno mientras sigue ahi. El aviso nunca lanza (notify se traga sus errores).
      const escalation = escalationNotificationFor(result.candidate, result.plannedTransitions);
      if (escalation) {
        await notifier.notify(escalation);
      }
    } catch (error) {
      console.error("[ig-webhook] ERROR procesando el turno", {
        message: error instanceof Error ? error.message : String(error)
      });
      // Aviso tecnico al operador (sin secretos ni stack): solo el tipo de error para que sepa que mirar.
      await notifier.notify({ kind: "error", detail: error instanceof Error ? error.name : "desconocido" });
      // Error TRANSITORIO (DB/red, p. ej. Neon caido): devolver 5xx para que Meta REINTENTE el turno
      // cuando el servicio vuelva (la idempotencia por mid evita duplicar lo ya procesado). Asi no se
      // pierde el mensaje de una candidata por un fallo pasajero. Un error NO transitorio (bug logico)
      // se traga con 200 para no provocar reintentos en bucle que Meta podria penalizar.
      if (isLikelyTransientError(error)) {
        console.warn("[ig-webhook] error transitorio -> 503 para que Meta reintente");
        return new NextResponse("Transient processing error, please retry", { status: 503 });
      }
    }
  }

  return NextResponse.json({ ok: true });
}

// Codigos/senales de error TRANSITORIO (no se pudo hablar con la BD/red): justifican un 5xx para que
// Meta reintente. Un error de datos o de logica NO entra aqui (no debe reintentarse en bucle).
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "57P03",
  "08006",
  "08001",
  "08004"
]);

function isLikelyTransientError(error: unknown, depth = 0): boolean {
  if (depth > 8 || typeof error !== "object" || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown };
  if (typeof candidate.code === "string" && TRANSIENT_ERROR_CODES.has(candidate.code)) return true;
  if (
    typeof candidate.message === "string" &&
    /(econn|etimedout|connect_timeout|connection|fetch failed|socket|terminat|too many connections|timeout)/i.test(
      candidate.message
    )
  ) {
    return true;
  }
  if (error instanceof AggregateError && error.errors.some((inner) => isLikelyTransientError(inner, depth + 1))) {
    return true;
  }
  return isLikelyTransientError(candidate.cause, depth + 1);
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
