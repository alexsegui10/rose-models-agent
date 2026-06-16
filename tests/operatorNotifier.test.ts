import { describe, expect, it, vi } from "vitest";
import {
  CallMeBotWhatsAppNotifier,
  NoopOperatorNotifier,
  escalationNotificationFor,
  formatOperatorMessage,
  getOperatorNotifier,
  isStopRequest
} from "@/infrastructure/integrations/operatorNotifier";

describe("operatorNotifier", () => {
  it("avisa SOLO al ENTRAR en revision humana este turno", () => {
    const entered = escalationNotificationFor(
      { instagramUsername: "u1", currentState: "HUMAN_INTERVENTION_REQUIRED", humanReviewReason: "PERCENTAGE_NEGOTIATION" },
      [{ toState: "HUMAN_INTERVENTION_REQUIRED" }]
    );
    expect(entered?.kind).toBe("escalation");
    expect(entered?.conversationId).toBe("u1");
    expect(entered?.reason).toContain("porcentaje");

    // Sin transicion a revision este turno -> no se avisa (no se repite mientras sigue en HIR).
    expect(
      escalationNotificationFor(
        { instagramUsername: "u1", currentState: "HUMAN_INTERVENTION_REQUIRED", humanReviewReason: "OTHER" },
        [{ toState: "QUALIFYING" }]
      )
    ).toBeNull();
  });

  it("formatea mensajes concisos por tipo (sin secretos)", () => {
    expect(formatOperatorMessage({ kind: "escalation", conversationId: "u1", reason: "negocia el porcentaje" })).toContain(
      "Escalada"
    );
    expect(formatOperatorMessage({ kind: "error", detail: "TypeError" })).toContain("Error");
    expect(formatOperatorMessage({ kind: "blocked", conversationId: "u1" })).toContain("bloqueado");
    expect(
      formatOperatorMessage({ kind: "escalation", conversationId: "u1", profileUrl: "https://instagram.com/ana_real" })
    ).toContain("https://instagram.com/ana_real");
  });

  it("isStopRequest distingue 'no me mandes nada' de un 'no me interesa' normal", () => {
    expect(isStopRequest("no me mandes nada por favor")).toBe(true);
    expect(isStopRequest("dejame en paz")).toBe(true);
    expect(isStopRequest("no me escribas mas")).toBe(true);
    expect(isStopRequest("uy no me interesa, gracias")).toBe(false);
    expect(isStopRequest("hola, cuanto se gana?")).toBe(false);
  });

  it("formatea el aviso de peticion de parada con el enlace de la candidata", () => {
    const msg = formatOperatorMessage({ kind: "stop-request", conversationId: "u1", profileUrl: "https://instagram.com/ana" });
    expect(msg).toContain("no la contactes");
    expect(msg).toContain("https://instagram.com/ana");
  });

  it("factory: Noop sin claves, CallMeBot con claves", () => {
    expect(getOperatorNotifier({})).toBeInstanceOf(NoopOperatorNotifier);
    expect(getOperatorNotifier({ CALLMEBOT_PHONE: "+34600", CALLMEBOT_APIKEY: "k" })).toBeInstanceOf(CallMeBotWhatsAppNotifier);
  });

  it("CallMeBot hace GET con telefono/apikey codificados y NO lanza si falla la red", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as Response);
    const notifier = new CallMeBotWhatsAppNotifier(
      { phone: "+34600111222", apiKey: "secret" },
      fetchMock as unknown as typeof fetch
    );
    await notifier.notify({ kind: "escalation", conversationId: "u1", reason: "negocia" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("api.callmebot.com/whatsapp.php");
    expect(url).toContain("phone=%2B34600111222");
    expect(url).toContain("apikey=secret");

    const failing = new CallMeBotWhatsAppNotifier({ phone: "x", apiKey: "y" }, (() =>
      Promise.reject(new Error("net"))) as unknown as typeof fetch);
    await expect(failing.notify({ kind: "error", detail: "x" })).resolves.toBeUndefined();
  });
});
