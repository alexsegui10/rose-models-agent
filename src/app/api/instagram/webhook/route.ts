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
import {
  escalationNotificationFor,
  followRequestNotificationFor,
  getOperatorNotifier,
  isStopRequest
} from "@/infrastructure/integrations/operatorNotifier";
import { fetchInstagramProfile, instagramProfileUrl } from "@/infrastructure/integrations/instagramProfileProvider";
import { getSimulatorEngine, getSimulatorRepository } from "@/server/simulatorStore";
import { getQStashConfig } from "@/application/qstashConfig";
import { scheduleInboundFlush, schedulePrivacyDetection } from "@/infrastructure/integrations/qstashClient";

// postgres.js necesita runtime Node (no Edge). maxDuration: en Hobby el techo real es 10s igualmente.
export const runtime = "nodejs";
export const maxDuration = 60;

// Ritmo de la rafaga (peticion de Alex: que no responda al instante y deje unos segundos entre
// mensajes). PRESUPUESTO total de pausa por turno: tope para convivir con el limite de 10s del plan
// gratis (la comprension+redaccion de OpenAI ya consume parte). Ajustable por env si se cambia de plan.
const BURST_DELAY_BUDGET_MS = Number(process.env.INSTAGRAM_BURST_DELAY_BUDGET_MS ?? 4500);
const BURST_DELAY_PER_MESSAGE_MAX_MS = Number(process.env.INSTAGRAM_BURST_DELAY_MAX_MS ?? 3200);
// Techo de tiempo por turno: margen de seguridad bajo el limite de ~10s de Vercel Hobby. El presupuesto
// de pausas se calcula como (este techo - tiempo ya gastado por OpenAI), para no provocar timeouts.
const TURN_TIME_BUDGET_MS = Number(process.env.INSTAGRAM_TURN_BUDGET_MS ?? 8500);
// Tope DURO: pasado este tiempo desde el inicio del turno, no se envian mas chunks de la rafaga (margen
// bajo el techo de ~10s de Vercel Hobby). Evita que la lambda muera a mitad de envio.
const HARD_TURN_DEADLINE_MS = Number(process.env.INSTAGRAM_HARD_DEADLINE_MS ?? 9000);
// Backoff antes de UN reintento de un chunk fallido (transitorio): que un fallo puntual no tire la rafaga.
const BURST_RETRY_BACKOFF_MS = Number(process.env.INSTAGRAM_BURST_RETRY_BACKOFF_MS ?? 600);

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
      bodyByteLen: buf.byteLength,
      bodyStrLen: rawBody.length,
      contentLength: request.headers.get("content-length"),
      // Huellas no reversibles para comparar secretos sin filtrarlos. No se loguea el prefijo de la firma
      // (recibida) ni la longitud de los secretos (secretLens), que daban pistas reaprovechables.
      secretFingerprints: config.appSecretCandidates.map(secretFingerprint)
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

  // Agrupar por remitente: si la misma candidata mando VARIOS mensajes seguidos en este payload, se
  // responden como UN turno (groupMessagesForTurn los une dentro de handleIncomingTurn), no uno a uno,
  // para que el bot no conteste a cada linea por separado. (La espera ~Ns para "dejarla terminar" entre
  // payloads distintos es la fase con cola/QStash, aparte.)
  const groupedBySender = new Map<string, { senderId: string; text: string; messageId?: string }>();
  for (const m of inbound) {
    const prev = groupedBySender.get(m.senderId);
    if (prev) {
      prev.text = `${prev.text}\n${m.text}`.trim();
      prev.messageId = [prev.messageId, m.messageId].filter(Boolean).join("|") || undefined;
    } else {
      groupedBySender.set(m.senderId, { senderId: m.senderId, text: m.text, messageId: m.messageId });
    }
  }
  const groupedInbound = [...groupedBySender.values()];

  // DEBOUNCE entrante (QStash + INBOUND_DEBOUNCE=on): en vez de responder al instante, se GUARDA el mensaje
  // EN ESPERA y se programa una llamada de vuelta a +Ns; cuando ella deja de escribir, el flush responde a
  // toda la rafaga de una vez. APAGADO por defecto -> sigue el comportamiento de siempre (responder ya).
  const qstash = getQStashConfig();
  if (qstash.isConfigured && qstash.debounceEnabled) {
    const flushUrl = `${new URL(request.url).origin}/api/instagram/flush`;
    const flushSecret = process.env.CRON_SECRET ?? "";
    for (const message of groupedInbound) {
      try {
        await engine.bufferInboundForDebounce({
          instagramUsername: message.senderId,
          messages: [{ content: message.text, externalMessageId: message.messageId }]
        });
        const scheduled = await scheduleInboundFlush({
          config: qstash,
          flushUrl,
          flushSecret,
          senderId: message.senderId,
          delaySeconds: Math.round(qstash.debounceMs / 1000)
        });
        if (!scheduled) {
          // No se pudo programar el flush: el mensaje quedo EN ESPERA sin callback -> 503 para que Meta
          // reintente (bufferInboundForDebounce es idempotente por mid, el reintento no duplica). Asi no
          // se queda un mensaje colgado sin respuesta si QStash falla.
          console.warn("[ig-webhook] no se pudo programar el flush (debounce) -> 503 para reintento");
          return new NextResponse("Could not schedule debounce flush, please retry", { status: 503 });
        }
        console.log("[ig-webhook] mensaje EN ESPERA (debounce)", { delaySec: Math.round(qstash.debounceMs / 1000) });
      } catch (error) {
        console.error("[ig-webhook] error al bufferizar (debounce)", {
          message: error instanceof Error ? error.message : String(error)
        });
        if (isLikelyTransientError(error)) {
          return new NextResponse("Transient processing error, please retry", { status: 503 });
        }
      }
    }
    return NextResponse.json({ ok: true, debounced: groupedInbound.length });
  }

  for (const message of groupedInbound) {
    try {
      // ¿Primer contacto? (la candidata no existia aun). Si lo es, tras enviar el saludo dispararemos la
      // deteccion de privada/publica EN SEGUNDO PLANO (Apify es lento; no debe bloquear la entrega).
      const wasNewContact = !(await getSimulatorRepository().findCandidateByInstagram(message.senderId));
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
          // Guard DURO de tiempo: si el turno se acerca al techo de ~10s de Vercel, no enviar mas chunks.
          // Mejor responder 200 con entrega parcial que dejar que Vercel mate la lambda a mitad de envio.
          if (Date.now() - turnStartedAt > HARD_TURN_DEADLINE_MS) {
            console.warn("[ig-webhook] presupuesto de tiempo casi agotado: se corta la rafaga", {
              enviados: i,
              total: chunks.length
            });
            break;
          }
          // Ritmo natural (peticion de Alex): unos segundos entre mensajes. La pausa va SOLO entre mensajes,
          // NO antes del primero (el 1er mensaje sale ya): asi se gana presupuesto y la rafaga entera entra
          // bajo el techo de ~10s de Vercel. Se reparte un presupuesto total de pausa; si se agota, los
          // ultimos salen seguidos en vez de tumbar la funcion.
          if (i > 0 && delayBudgetMs > 0) {
            const wait = Math.min(naturalSendDelayMs(chunks[i]), delayBudgetMs);
            delayBudgetMs -= wait;
            await sleep(wait);
          }
          // Envio con UN reintento corto: un fallo RAPIDO (rechazo de API/red, no entregado) NO debe tirar
          // toda la rafaga (la candidata se quedaba solo con el 1er mensaje). Si tras el reintento sigue
          // fallando, ABORTAMOS el resto (no enviar fuera de orden/contexto) con traza de entrega parcial.
          const sendStart = Date.now();
          let sent = await provider.sendTextMessage(message.senderId, chunks[i]);
          // Solo se reintenta si el fallo fue RAPIDO (<3s): un TIMEOUT (~3.5s) pudo haberse entregado igual
          // en Meta y reintentar duplicaria el mensaje. Y solo si queda margen REAL bajo el techo de ~10s,
          // descontando el backoff + el timeout del propio reintento (si no, podria morir la lambda a mitad).
          const failedFast = Date.now() - sendStart < 3000;
          const retryDeadlineMs = HARD_TURN_DEADLINE_MS - BURST_RETRY_BACKOFF_MS - 3500;
          if (!sent && failedFast && Date.now() - turnStartedAt < retryDeadlineMs) {
            await sleep(BURST_RETRY_BACKOFF_MS);
            sent = await provider.sendTextMessage(message.senderId, chunks[i]);
            console.log("[ig-webhook] reintento de envio", { sent, parte: `${i + 1}/${chunks.length}` });
          }
          console.log("[ig-webhook] envio a Instagram", { sent, parte: `${i + 1}/${chunks.length}` });
          if (!sent) {
            console.warn("[ig-webhook] entrega PARCIAL: chunk fallido tras reintento, se aborta el resto", {
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

      // Deteccion de privada/publica EN SEGUNDO PLANO: solo en el PRIMER contacto y si la visibilidad sigue
      // sin saberse. Se publica en QStash para correr en una invocacion APARTE (Apify tarda) y avisar a Alex
      // por WhatsApp si es privada. Fire-and-forget: jamas bloquea ni rompe el turno (el saludo ya salio).
      if (wasNewContact && result.candidate.declaredProfileVisibility === "UNKNOWN") {
        const detectUrl = `${new URL(request.url).origin}/api/instagram/detect-privacy`;
        void schedulePrivacyDetection({
          config: qstash,
          detectUrl,
          secret: process.env.CRON_SECRET ?? "",
          senderId: message.senderId
        }).catch(() => {});
      }
      // Aviso al operador SOLO cuando la candidata ENTRA este turno en revision humana (escalada), no en
      // cada turno mientras sigue ahi. El aviso nunca lanza (notify se traga sus errores). En una escalada
      // el bot NO envia rafaga, asi que hay margen de tiempo para resolver el perfil (cacheado) y meter el
      // enlace a su cuenta en el WhatsApp; best-effort, jamas rompe el turno.
      const escalation = escalationNotificationFor(result.candidate, result.plannedTransitions);
      // Cuenta PRIVADA detectada en el opener: la candidata entra en WAITING_PROFILE_ACCESS y se avisa a
      // Alex para que ENVIE la solicitud de seguimiento desde la cuenta de la agencia (peticion de Alex).
      const followRequest = followRequestNotificationFor(result.candidate, result.plannedTransitions);
      // Peticion explicita de no contacto ("no me mandes nada"): el bot cierra (CLOSED) pero AVISA a Alex
      // para que sepa lo que paso (peticion de Alex). Un "no me interesa" normal sigue cerrando en silencio.
      const enteredClosed = result.plannedTransitions.some((transition) => transition.toState === "CLOSED");
      const stopRequested = enteredClosed && isStopRequest(message.text);
      if (escalation || followRequest || stopRequested) {
        const profile = await fetchInstagramProfile(message.senderId, config);
        const profileUrl = instagramProfileUrl(profile?.username) ?? undefined;
        if (escalation) await notifier.notify({ ...escalation, profileUrl });
        if (followRequest) await notifier.notify({ ...followRequest, profileUrl });
        if (stopRequested) await notifier.notify({ kind: "stop-request", conversationId: message.senderId, profileUrl });
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
