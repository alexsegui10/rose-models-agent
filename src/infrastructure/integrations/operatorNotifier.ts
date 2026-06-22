import type { Candidate, HumanReviewReason, StateTransition } from "@/domain/candidate";

/**
 * Avisos al OPERADOR (Alex): cuando el bot escala a decisión humana, bloquea un envío o falla algo
 * técnico, se le manda un aviso (p. ej. WhatsApp) para que pueda dejar el bot corriendo y entrar solo
 * cuando hace falta. Secretos en `.env.local`; si no está configurado, el aviso es un no-op silencioso
 * y NUNCA tumba el turno (el procesamiento del mensaje es lo primero).
 */
export type OperatorNotificationKind = "escalation" | "blocked" | "error" | "stop-request" | "follow-request";

// isStopRequest vive ahora en domain (funcion pura) para que la compartan infra y application sin cruzar
// capas; se re-exporta aqui para no romper los imports existentes (webhook).
export { isStopRequest } from "@/domain/stopRequest";

export interface OperatorNotification {
  kind: OperatorNotificationKind;
  /** Identificador de la conversación (IGSID/usuario) para localizarla en el CRM. */
  conversationId?: string;
  /** Motivo en lenguaje claro (ya traducido), sin datos sensibles innecesarios. */
  reason?: string;
  /** Estado resultante de la candidata. */
  state?: string;
  /** Enlace publico a la cuenta de Instagram de la candidata (si se pudo resolver). */
  profileUrl?: string;
  /** Detalle corto para errores; nunca stack traces ni secretos. */
  detail?: string;
  /** En follow-request: ¿el bot YA le pidio a la candidata que acepte la solicitud (opener privado)? Si la
   * privacidad se detecto DESPUES (en segundo plano, con el opener publico ya enviado), es false. */
  botAskedToAccept?: boolean;
}

export interface OperatorNotifier {
  notify(notification: OperatorNotification): Promise<void>;
}

/** Notificador inerte: cuando no hay configuración (simulador, tests, env sin claves). */
export class NoopOperatorNotifier implements OperatorNotifier {
  async notify(): Promise<void> {
    // Silencio deliberado.
  }
}

const REVIEW_REASON_LABELS: Record<HumanReviewReason, string> = {
  PROFILE_REVIEW: "revisar perfil",
  PERCENTAGE_NEGOTIATION: "negocia el porcentaje",
  COMMERCIAL_EXCEPTION: "pide una excepción comercial",
  CONTRACT_QUESTION: "duda de contrato/legal",
  DATA_CONTRADICTION: "dato contradictorio",
  DEVICE_QUALITY_REVIEW: "revisa la calidad del móvil y aprueba o no",
  OTHER: "revisión humana"
};

export function reviewReasonLabel(reason: HumanReviewReason | undefined): string {
  return reason ? (REVIEW_REASON_LABELS[reason] ?? "revisión humana") : "revisión humana";
}

const REVIEW_STATES: ReadonlySet<string> = new Set(["HUMAN_INTERVENTION_REQUIRED", "WAITING_HUMAN_REVIEW"]);

/**
 * Decide (de forma PURA, testeable) si un turno merece avisar al operador por una ESCALADA: solo cuando
 * la candidata ENTRA este turno en un estado de revisión humana (no en cada turno posterior mientras
 * sigue ahí, para no repetir el aviso). Devuelve la notificación o null.
 */
export function escalationNotificationFor(
  candidate: Pick<Candidate, "instagramUsername" | "currentState" | "humanReviewReason"> & {
    deviceModel?: Candidate["deviceModel"];
  },
  plannedTransitions: Pick<StateTransition, "toState">[]
): OperatorNotification | null {
  const enteredReview = plannedTransitions.some((transition) => REVIEW_STATES.has(transition.toState));
  if (!enteredReview) return null;
  // Para la revision de calidad del movil, el motivo incluye el modelo concreto ("revisa la calidad del
  // movil (iphone 11) y aprueba o no") para que Alex sepa de un vistazo que tiene que mirar.
  const reason =
    candidate.humanReviewReason === "DEVICE_QUALITY_REVIEW"
      ? `revisa la calidad del movil${candidate.deviceModel ? ` (${candidate.deviceModel})` : ""} y aprueba o no`
      : reviewReasonLabel(candidate.humanReviewReason);
  return {
    kind: "escalation",
    conversationId: candidate.instagramUsername,
    reason,
    state: candidate.currentState
  };
}

const PROFILE_ACCESS_STATE = "WAITING_PROFILE_ACCESS";

/**
 * Aviso para que ALEX envíe la solicitud de seguimiento: solo cuando la candidata ENTRA este turno en
 * WAITING_PROFILE_ACCESS (cuenta detectada como privada en el opener). Igual que la escalada, se avisa al
 * entrar, no en cada turno posterior. Devuelve la notificación o null.
 */
export function followRequestNotificationFor(
  candidate: Pick<Candidate, "instagramUsername">,
  plannedTransitions: Pick<StateTransition, "toState">[]
): OperatorNotification | null {
  const entered = plannedTransitions.some((transition) => transition.toState === PROFILE_ACCESS_STATE);
  if (!entered) return null;
  // Aqui la privacidad se detecto EN el opener -> el bot ya envio el opener privado pidiendo aceptar.
  return {
    kind: "follow-request",
    conversationId: candidate.instagramUsername,
    state: PROFILE_ACCESS_STATE,
    botAskedToAccept: true
  };
}

/** Mensaje corto y escaneable para el operador. Mínimo de datos (solo lo necesario para actuar). */
export function formatOperatorMessage(notification: OperatorNotification): string {
  if (notification.kind === "follow-request") {
    const who = notification.conversationId ? `\nConversación: ${notification.conversationId}` : "";
    const profile = notification.profileUrl ? `\nPerfil: ${notification.profileUrl}` : "";
    // Solo si el bot ya envio el opener privado pidiendo aceptar (detectada EN el opener). Si la privacidad
    // se detecto despues en segundo plano (con el opener publico ya enviado), NO afirmamos que el bot pidio.
    const askedLine = notification.botAskedToAccept ? "\nEl bot ya le ha pedido que la acepte." : "";
    return `Rose Models 📩 Cuenta PRIVADA: envíale tú la solicitud de seguimiento desde la cuenta de la agencia.${who}${profile}${askedLine}`;
  }
  if (notification.kind === "error") {
    return `Rose Models ⚠️ Error procesando un mensaje en el webhook${notification.detail ? `: ${notification.detail}` : "."} Revisa los logs.`;
  }
  if (notification.kind === "blocked") {
    const who = notification.conversationId ? `\nConversación: ${notification.conversationId}` : "";
    return `Rose Models ⛔ Envío bloqueado${who}${notification.detail ? `\n${notification.detail}` : ""}`;
  }
  if (notification.kind === "stop-request") {
    const who = notification.conversationId ? `\nConversación: ${notification.conversationId}` : "";
    const profile = notification.profileUrl ? `\nPerfil: ${notification.profileUrl}` : "";
    return `Rose Models 🛑 Una candidata ha pedido que no la contactes${who}${profile}\nEl bot ha parado; gestiona tú si quieres.`;
  }
  const who = notification.conversationId ? `\nConversación: ${notification.conversationId}` : "";
  const reason = notification.reason ? `\nMotivo: ${notification.reason}` : "";
  const profile = notification.profileUrl ? `\nPerfil: ${notification.profileUrl}` : "";
  return `Rose Models 🔔 Escalada, necesita tu decisión${who}${reason}${profile}\nEntra al CRM para resolverla.`;
}

/**
 * Aviso por WhatsApp vía CallMeBot (gratis, personal). Hace un GET a su API con el teléfono y la apikey
 * de `.env.local`. No lanza si falla (sólo loguea sin secretos): un aviso caído jamás debe romper el turno.
 */
export class CallMeBotWhatsAppNotifier implements OperatorNotifier {
  constructor(
    private readonly config: { phone: string; apiKey: string },
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async notify(notification: OperatorNotification): Promise<void> {
    const text = formatOperatorMessage(notification);
    const url =
      `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(this.config.phone)}` +
      `&text=${encodeURIComponent(text)}&apikey=${encodeURIComponent(this.config.apiKey)}`;
    try {
      const response = await this.fetchImpl(url, { method: "GET" });
      if (!response.ok) {
        console.warn("[notify] CallMeBot rechazó el aviso", { status: response.status });
      }
    } catch (error) {
      console.warn("[notify] error de red al avisar al operador", {
        error: error instanceof Error ? error.name : "unknown"
      });
    }
  }
}

/**
 * Factory: si están las claves de CallMeBot en el entorno, devuelve el notificador real; si no, el no-op.
 * Así el simulador/tests no avisan y producción sin configurar tampoco se cae.
 */
export function getOperatorNotifier(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): OperatorNotifier {
  const phone = env.CALLMEBOT_PHONE?.trim() ?? "";
  const apiKey = env.CALLMEBOT_APIKEY?.trim() ?? "";
  if (phone && apiKey) {
    return new CallMeBotWhatsAppNotifier({ phone, apiKey }, fetchImpl);
  }
  return new NoopOperatorNotifier();
}
