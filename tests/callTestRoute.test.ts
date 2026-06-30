import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock de ElevenLabs para NO llamar de verdad.
const h = vi.hoisted(() => ({
  isConfigured: true,
  startResult: { ok: true, conversationId: "conv-test" } as { ok: boolean; conversationId?: string; reason?: string },
  startSpy: vi.fn()
}));
vi.mock("@/infrastructure/integrations/elevenLabsOutbound", () => ({
  getElevenLabsOutboundConfig: () => ({
    isConfigured: h.isConfigured,
    apiKey: "k",
    agentId: "a",
    agentPhoneNumberId: "p"
  }),
  startOutboundSipCall: async (...args: unknown[]) => {
    h.startSpy(...args);
    return h.startResult;
  }
}));

import { POST } from "@/app/api/call/test/route";

function req(body: unknown) {
  return new Request("http://localhost/api/call/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  h.isConfigured = true;
  h.startResult = { ok: true, conversationId: "conv-test" };
  h.startSpy.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("llamada de PRUEBA /api/call/test", () => {
  it("con numero + ElevenLabs configurado -> dispara la llamada al numero tecleado", async () => {
    const res = await POST(req({ phone: "+34611022254" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(h.startSpy).toHaveBeenCalledTimes(1);
    // El candidato sintetico llevaba el numero tecleado.
    const [candidate] = h.startSpy.mock.calls[0] as [{ phone?: string; firstName?: string }];
    expect(candidate.phone).toBe("+34611022254");
  });

  it("sin numero valido -> 400, no llama", async () => {
    const res = await POST(req({ phone: "123" }));
    expect(res.status).toBe(400);
    expect(h.startSpy).not.toHaveBeenCalled();
  });

  it("ElevenLabs sin configurar -> 503, no llama", async () => {
    h.isConfigured = false;
    const res = await POST(req({ phone: "+34611022254" }));
    expect(res.status).toBe(503);
    expect(h.startSpy).not.toHaveBeenCalled();
  });
});
