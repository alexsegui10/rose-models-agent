import { describe, expect, it, vi } from "vitest";
import {
  getElevenLabsOutboundConfig,
  startOutboundWhatsAppCall,
  type ElevenLabsOutboundConfig
} from "@/infrastructure/integrations/elevenLabsOutbound";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "17841400000000000", displayName: "Marina" }),
    firstName: "Marina",
    age: 27,
    phone: "+34 600 11 22 33",
    conversationSummary: "Tiene OF, quiere crecer.",
    ...overrides
  });
}

const config: ElevenLabsOutboundConfig = {
  isConfigured: true,
  apiKey: "xi-key",
  agentId: "agent-123",
  whatsappPhoneNumberId: "wa-phone-1",
  permissionTemplateName: "call_permission",
  permissionTemplateLang: "es"
};

describe("startOutboundWhatsAppCall", () => {
  it("no llama si no está configurado", async () => {
    const fetchMock = vi.fn();
    const result = await startOutboundWhatsAppCall(
      candidate(),
      { ...config, isConfigured: false },
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no llama si la candidata no tiene teléfono", async () => {
    const fetchMock = vi.fn();
    const result = await startOutboundWhatsAppCall(candidate({ phone: undefined }), config, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTea al endpoint correcto con los campos y el contexto del DM", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ conversation_id: "conv-789" })
    } as Response);
    const result = await startOutboundWhatsAppCall(candidate(), config, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.conversationId).toBe("conv-789");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/convai/whatsapp/outbound-call");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("xi-key");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.agent_id).toBe("agent-123");
    expect(sent.whatsapp_phone_number_id).toBe("wa-phone-1");
    expect(sent.whatsapp_user_id).toBe("34600112233"); // normalizado a dígitos
    expect(sent.whatsapp_call_permission_request_template_name).toBe("call_permission");
    expect(sent.conversation_initiation_client_data.dynamic_variables.candidate_name).toBe("Marina");
    expect(sent.conversation_initiation_client_data.dynamic_variables.candidate_id).toBeTruthy();
  });

  it("devuelve el motivo si ElevenLabs rechaza", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: "plantilla no encontrada" })
    } as Response);
    const result = await startOutboundWhatsAppCall(candidate(), config, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("422");
  });

  it("getElevenLabsOutboundConfig: isConfigured solo con todas las vars", () => {
    expect(getElevenLabsOutboundConfig({} as NodeJS.ProcessEnv).isConfigured).toBe(false);
    const full = getElevenLabsOutboundConfig({
      ELEVENLABS_API_KEY: "k",
      ELEVENLABS_AGENT_ID: "a",
      ELEVENLABS_WHATSAPP_PHONE_NUMBER_ID: "p",
      ELEVENLABS_CALL_PERMISSION_TEMPLATE: "t"
    } as unknown as NodeJS.ProcessEnv);
    expect(full.isConfigured).toBe(true);
    expect(full.permissionTemplateLang).toBe("es");
  });
});
