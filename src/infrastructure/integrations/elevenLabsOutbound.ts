import { buildCallContext, summarizeCallContext } from "@/application/callContext";
import type { Candidate } from "@/domain/candidate";

/**
 * Disparador de la LLAMADA saliente por TELEFONO (SIP, vía Zadarma) usando ElevenLabs Agents.
 * POST https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call
 *
 * ElevenLabs marca directamente al número de la candidata a través del número SIP importado (Zadarma) y
 * conecta nuestro agente (que delega en /api/call/llm). A diferencia de WhatsApp NO hay permiso previo:
 * la llamada suena al instante, así que el aviso legal + grabación (CALL_DISCLOSURE) debe ir activo en prod.
 * El contexto del DM va en `conversation_initiation_client_data.dynamic_variables` (mejor esfuerzo; la
 * llamada funciona aunque el contexto sea parcial). No expone secretos: la API key viaja solo en la
 * cabecera y las credenciales SIP de Zadarma las guarda ElevenLabs (aquí el número se referencia solo por
 * su agent_phone_number_id; nunca usuario/contraseña SIP en el repo — invariantes 5 y 7).
 */

export interface ElevenLabsOutboundConfig {
  isConfigured: boolean;
  apiKey: string;
  agentId: string;
  agentPhoneNumberId: string;
}

export function getElevenLabsOutboundConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsOutboundConfig {
  const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? "";
  const agentId = env.ELEVENLABS_AGENT_ID?.trim() ?? "";
  const agentPhoneNumberId = env.ELEVENLABS_AGENT_PHONE_NUMBER_ID?.trim() ?? "";
  const isConfigured = Boolean(apiKey && agentId && agentPhoneNumberId);
  return { isConfigured, apiKey, agentId, agentPhoneNumberId };
}

export interface OutboundCallResult {
  ok: boolean;
  conversationId?: string;
  reason?: string;
}

// Variables dinámicas (planas) con el contexto del DM, para que el agente sepa con quién habla.
function buildDynamicVariables(candidate: Candidate): Record<string, string | number | boolean> {
  const context = buildCallContext(candidate);
  const vars: Record<string, string | number | boolean> = { candidate_id: candidate.id };
  if (context.candidateName) vars.candidate_name = context.candidateName;
  if (typeof context.age === "number") vars.age = context.age;
  if (context.country) vars.country = context.country;
  if (typeof context.hasOnlyFans === "boolean") vars.has_onlyfans = context.hasOnlyFans;
  if (typeof context.worksWithAnotherAgency === "boolean") vars.works_with_another_agency = context.worksWithAnotherAgency;
  if (context.scheduledSlot) vars.scheduled_slot = context.scheduledSlot;
  if (context.interestLevel) vars.interest_level = context.interestLevel;
  if (context.dmSummary) vars.dm_summary = context.dmSummary;
  if (context.concerns.length > 0) vars.concerns = context.concerns.join("; ");
  vars.context_summary = summarizeCallContext(context);
  return vars;
}

/**
 * Normaliza el número a E.164 CON '+' para el trunk SIP (que lo exige; pelar el '+' haría que el trunk
 * rechace la llamada). Reglas: si trae '+' o prefijo internacional (00) se respeta el código de país tal
 * cual; si viene un número local "pelado" sin código, se asume Argentina (+54), porque las candidatas son
 * de allí. Para MÓVILES argentinos se inserta el '9' tras el 54 (+549...), asumiendo móvil (decisión de
 * Alex: es lo normal en captación). Solo afecta a +54; otros países (p.ej. +34 España) no se tocan.
 */
export function normalizeToE164(phone: string): string {
  const trimmed = phone.trim();
  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (!hadPlus && digits.startsWith("00")) {
    digits = digits.slice(2); // 00 = prefijo internacional, equivale a '+'
  } else if (!hadPlus && !digits.startsWith("54")) {
    digits = `54${digits}`; // número local argentino sin código de país
  }
  // Argentina: los móviles exigen el '9' tras el 54 (+549...). Se inserta si falta (asumimos móvil; un fijo
  // quedaría mal, asumido a cambio de que los móviles —el caso normal— conecten). No toca otros países.
  if (digits.startsWith("54") && !digits.startsWith("549")) {
    digits = `549${digits.slice(2)}`;
  }
  return `+${digits}`;
}

export async function startOutboundSipCall(
  candidate: Candidate,
  config: ElevenLabsOutboundConfig,
  fetchImpl: typeof fetch = fetch
): Promise<OutboundCallResult> {
  if (!config.isConfigured) {
    return { ok: false, reason: "ElevenLabs no está configurado (faltan ELEVENLABS_* en el entorno)." };
  }
  const phone = candidate.phone?.trim();
  if (!phone) {
    return { ok: false, reason: "La candidata no tiene número de teléfono guardado." };
  }
  const toNumber = normalizeToE164(phone);
  if (!toNumber) {
    return { ok: false, reason: "El número de teléfono no es válido." };
  }

  const body = {
    agent_id: config.agentId,
    agent_phone_number_id: config.agentPhoneNumberId,
    to_number: toNumber,
    conversation_initiation_client_data: {
      dynamic_variables: buildDynamicVariables(candidate),
      // Cinturón + tirantes (jul-2026, llamada real sin nombre): las mismas variables TAMBIÉN como
      // custom_llm_extra_body — es lo que ElevenLabs reenvía a nuestro Custom LLM cuando el toggle
      // "Custom LLM extra body" del agente está activo. Así el contexto llega por la vía que esté abierta.
      custom_llm_extra_body: buildDynamicVariables(candidate)
    }
  };

  try {
    const response = await fetchImpl("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": config.apiKey },
      body: JSON.stringify(body),
      // Timeout defensivo (jul-2026): sin él, un cuelgue de la API mataba la lambda entera (techo ~10s de
      // Vercel) SIN registrar el intento -> el tope de 3 llamadas dejaba de ser fiable. 6.5s deja margen.
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = (await response.json()) as { detail?: { message?: unknown } | string };
        if (typeof errorBody.detail === "string") detail = errorBody.detail;
        else if (errorBody.detail && typeof errorBody.detail.message === "string") detail = errorBody.detail.message;
      } catch {
        /* sin cuerpo JSON */
      }
      return { ok: false, reason: `ElevenLabs respondió ${response.status}${detail ? `: ${detail}` : ""}` };
    }
    // El endpoint SIP devuelve { success, conversation_id (puede ser null), sip_call_id }. success===false
    // = la llamada NO arrancó aunque el HTTP sea 200 -> es un fallo (no contar intento ni dar por buena la
    // grabación). El audio depende de un conversation_id no nulo.
    const data = (await response.json()) as { success?: boolean; conversation_id?: unknown; message?: unknown };
    if (data.success === false) {
      const message = typeof data.message === "string" ? data.message : "";
      return { ok: false, reason: `ElevenLabs no pudo iniciar la llamada${message ? `: ${message}` : ""}` };
    }
    return { ok: true, conversationId: typeof data.conversation_id === "string" ? data.conversation_id : undefined };
  } catch (error) {
    return { ok: false, reason: `error de red (${error instanceof Error ? error.name : "desconocido"})` };
  }
}
