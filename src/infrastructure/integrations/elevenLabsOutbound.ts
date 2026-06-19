import { buildCallContext, summarizeCallContext } from "@/application/callContext";
import type { Candidate } from "@/domain/candidate";

/**
 * Disparador de la LLAMADA saliente por WhatsApp vía ElevenLabs Agents.
 * POST https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call
 *
 * ElevenLabs envía a la candidata una solicitud de permiso de llamada (plantilla de WhatsApp Manager) y,
 * en cuanto ella la aprueba, hace la llamada con nuestro agente (que delega en /api/call/llm). El contexto
 * del DM va en `conversation_initiation_client_data.dynamic_variables` (mejor esfuerzo; la llamada funciona
 * aunque el contexto sea parcial). No expone secretos: la API key viaja solo en la cabecera.
 */

export interface ElevenLabsOutboundConfig {
  isConfigured: boolean;
  apiKey: string;
  agentId: string;
  whatsappPhoneNumberId: string;
  permissionTemplateName: string;
  permissionTemplateLang: string;
}

export function getElevenLabsOutboundConfig(env: NodeJS.ProcessEnv = process.env): ElevenLabsOutboundConfig {
  const apiKey = env.ELEVENLABS_API_KEY?.trim() ?? "";
  const agentId = env.ELEVENLABS_AGENT_ID?.trim() ?? "";
  const whatsappPhoneNumberId = env.ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const permissionTemplateName = env.ELEVENLABS_CALL_PERMISSION_TEMPLATE?.trim() ?? "";
  const permissionTemplateLang = env.ELEVENLABS_CALL_PERMISSION_TEMPLATE_LANG?.trim() || "es";
  const isConfigured = Boolean(apiKey && agentId && whatsappPhoneNumberId && permissionTemplateName);
  return { isConfigured, apiKey, agentId, whatsappPhoneNumberId, permissionTemplateName, permissionTemplateLang };
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

/** Normaliza el número de WhatsApp a dígitos (formato internacional sin símbolos). */
function normalizeWhatsappId(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

export async function startOutboundWhatsAppCall(
  candidate: Candidate,
  config: ElevenLabsOutboundConfig,
  fetchImpl: typeof fetch = fetch
): Promise<OutboundCallResult> {
  if (!config.isConfigured) {
    return { ok: false, reason: "ElevenLabs no está configurado (faltan ELEVENLABS_* en el entorno)." };
  }
  const phone = candidate.phone?.trim();
  if (!phone) {
    return { ok: false, reason: "La candidata no tiene número de WhatsApp guardado." };
  }

  const body = {
    whatsapp_phone_number_id: config.whatsappPhoneNumberId,
    whatsapp_user_id: normalizeWhatsappId(phone),
    whatsapp_call_permission_request_template_name: config.permissionTemplateName,
    whatsapp_call_permission_request_template_language_code: config.permissionTemplateLang,
    agent_id: config.agentId,
    conversation_initiation_client_data: {
      dynamic_variables: buildDynamicVariables(candidate)
    }
  };

  try {
    const response = await fetchImpl("https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call", {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": config.apiKey },
      body: JSON.stringify(body)
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
    const data = (await response.json()) as { conversation_id?: unknown };
    return { ok: true, conversationId: typeof data.conversation_id === "string" ? data.conversation_id : undefined };
  } catch (error) {
    return { ok: false, reason: `error de red (${error instanceof Error ? error.name : "desconocido"})` };
  }
}
