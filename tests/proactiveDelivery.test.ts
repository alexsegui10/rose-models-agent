import { describe, expect, it } from "vitest";
import { candidateChannel, deliverProactiveMessage } from "@/server/proactiveDelivery";

// Entrega de mensajes proactivos del CRM (aprobaciones) al canal de la candidata. Cierra el hueco por el
// que las decisiones del CRM guardaban el mensaje pero no lo enviaban a Instagram (feedback 22-jun).

describe("proactiveDelivery: canal de la candidata", () => {
  it("detecta el canal por la clave de conversacion", () => {
    expect(candidateChannel("wa:34600111222")).toBe("whatsapp");
    expect(candidateChannel("17841400000000001")).toBe("instagram");
    expect(candidateChannel("candidata_123")).toBe("none");
    expect(candidateChannel("lead_demo")).toBe("none");
  });

  it("NO envia a fuera para candidatas del simulador (canal none)", async () => {
    const result = await deliverProactiveMessage({ instagramUsername: "candidata_123", phone: undefined }, "hola");
    expect(result.delivered).toBe(false);
    expect(result.channel).toBe("none");
  });

  it("mensaje vacio -> no envia", async () => {
    const result = await deliverProactiveMessage({ instagramUsername: "17841400000000001", phone: undefined }, "   ");
    expect(result.delivered).toBe(false);
  });
});
