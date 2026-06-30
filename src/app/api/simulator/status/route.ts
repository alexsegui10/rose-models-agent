import { NextResponse } from "next/server";
import { getLlmRuntimeConfig } from "@/application/llmConfig";
import { getPersistenceMode } from "@/server/simulatorStore";
import { getElevenLabsOutboundConfig } from "@/infrastructure/integrations/elevenLabsOutbound";
import { getQStashConfig } from "@/application/qstashConfig";

/**
 * Estado runtime REAL del simulador (invariante 6: nunca mentir sobre el modo activo).
 * Solo expone modos, nombres de modelo y banderas SI/NO de integraciones; jamas claves API ni DATABASE_URL.
 * El bloque `voiceCall` deja que Alex VEA que esta conectado en produccion sin pedirmelo (todo booleano).
 */
function has(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  const llmConfig = getLlmRuntimeConfig();
  const outbound = getElevenLabsOutboundConfig();
  const qstash = getQStashConfig();
  const cronSecret = has("CRON_SECRET");
  return NextResponse.json({
    persistenceMode: getPersistenceMode(),
    llmMode: llmConfig.llmMode,
    writingModel: llmConfig.writingModel,
    voiceCall: {
      // ¿Se puede lanzar la llamada saliente (boton "Llamar" + auto-marcador)? Necesita los 3 de abajo:
      outboundReady: outbound.isConfigured,
      elevenLabsApiKey: has("ELEVENLABS_API_KEY"),
      elevenLabsAgentId: has("ELEVENLABS_AGENT_ID"),
      agentPhoneNumberId: has("ELEVENLABS_AGENT_PHONE_NUMBER_ID"),
      // Cerebro en llamada (Custom LLM) + webhook de fin (resultado/grabacion):
      customLlmKey: has("CALL_LLM_API_KEY"),
      endWebhookSecret: has("CALL_WEBHOOK_SECRET"),
      // Auto-marcador (que llame SOLO a la hora): necesita cron + QStash + outbound:
      cronSecret,
      qstash: Boolean(qstash.token),
      autoDialerReady: cronSecret && Boolean(qstash.token) && outbound.isConfigured,
      // Aviso legal de IA/grabacion (obligatorio en produccion). on = activo.
      disclosureOn: process.env.CALL_DISCLOSURE?.trim() !== "off"
    }
  });
}
