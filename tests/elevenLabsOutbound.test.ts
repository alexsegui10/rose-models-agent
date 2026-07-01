import { describe, expect, it, vi } from "vitest";
import {
  getElevenLabsOutboundConfig,
  normalizeToE164,
  startOutboundSipCall,
  type ElevenLabsOutboundConfig
} from "@/infrastructure/integrations/elevenLabsOutbound";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "17841400000000000", displayName: "Marina" }),
    firstName: "Marina",
    age: 27,
    phone: "+54 9 11 1234 5678",
    conversationSummary: "Tiene OF, quiere crecer.",
    ...overrides
  });
}

const config: ElevenLabsOutboundConfig = {
  isConfigured: true,
  apiKey: "xi-key",
  agentId: "agent-123",
  agentPhoneNumberId: "phone-num-1"
};

describe("startOutboundSipCall", () => {
  it("no llama si no está configurado", async () => {
    const fetchMock = vi.fn();
    const result = await startOutboundSipCall(
      candidate(),
      { ...config, isConfigured: false },
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no llama si la candidata no tiene teléfono", async () => {
    const fetchMock = vi.fn();
    const result = await startOutboundSipCall(candidate({ phone: undefined }), config, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTea al endpoint SIP con agent_phone_number_id, to_number en E.164 y el contexto del DM", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, conversation_id: "conv-789" })
    } as Response);
    const result = await startOutboundSipCall(candidate(), config, fetchMock as unknown as typeof fetch);

    expect(result.ok).toBe(true);
    expect(result.conversationId).toBe("conv-789");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call");
    expect((init as RequestInit).method).toBe("POST");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["xi-api-key"]).toBe("xi-key");
    const sent = JSON.parse(String((init as RequestInit).body));
    expect(sent.agent_id).toBe("agent-123");
    expect(sent.agent_phone_number_id).toBe("phone-num-1");
    expect(sent.to_number).toBe("+5491112345678"); // E.164 conservando el '+'
    expect(sent.conversation_initiation_client_data.dynamic_variables.candidate_name).toBe("Marina");
    expect(sent.conversation_initiation_client_data.dynamic_variables.candidate_id).toBeTruthy();
  });

  it("trata success===false como fallo aunque el HTTP sea 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, message: "trunk rejected", conversation_id: null })
    } as Response);
    const result = await startOutboundSipCall(candidate(), config, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("trunk rejected");
  });

  it("devuelve el motivo si ElevenLabs rechaza (HTTP no ok)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: "numero invalido" })
    } as Response);
    const result = await startOutboundSipCall(candidate(), config, fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("422");
  });

  it("getElevenLabsOutboundConfig: isConfigured solo con todas las vars", () => {
    expect(getElevenLabsOutboundConfig({} as NodeJS.ProcessEnv).isConfigured).toBe(false);
    const full = getElevenLabsOutboundConfig({
      ELEVENLABS_API_KEY: "k",
      ELEVENLABS_AGENT_ID: "a",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: "p"
    } as unknown as NodeJS.ProcessEnv);
    expect(full.isConfigured).toBe(true);
    expect(full.agentPhoneNumberId).toBe("p");
  });
});

describe("normalizeToE164 (el trunk SIP exige E.164 con '+')", () => {
  it("conserva el '+' y el código de país que ya trae; NO mete el 9 a España", () => {
    expect(normalizeToE164("+34 600 11 22 33")).toBe("+34600112233");
  });
  it("móvil argentino con '+' y 9 se conserva igual (no duplica el 9)", () => {
    expect(normalizeToE164("+54 9 11 1234 5678")).toBe("+5491112345678");
  });
  it("móvil argentino SIN el 9 -> se le inserta el 9 (asumimos móvil)", () => {
    expect(normalizeToE164("+54 11 5352 8311")).toBe("+5491153528311");
  });
  it("número local pelado (sin código país) -> Argentina móvil (+549)", () => {
    expect(normalizeToE164("11 2345-6789")).toBe("+5491123456789");
  });
  it("prefijo internacional 00 -> móvil argentino (+549)", () => {
    expect(normalizeToE164("0054 11 2345 6789")).toBe("+5491123456789");
  });
  it("número que ya empieza por 54 con 9 no duplica nada", () => {
    expect(normalizeToE164("54 9 11 1234 5678")).toBe("+5491112345678");
  });
});
