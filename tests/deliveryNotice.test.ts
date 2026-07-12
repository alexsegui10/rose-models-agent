import { describe, it, expect, expectTypeOf } from "vitest";
import { classifyDelivery, wasDeliveredToCandidate, type SentToCandidate } from "@/application/deliveryNotice";
import type { DecisionOutcome } from "@/server/resumeReprocess";

// LOTE 1 "verdad de entrega" (jul-2026): el CRM decia "El bot le escribio" cuando el envio a Meta habia
// fallado, porque la UI evaluaba `sentToCandidate` (un OBJETO { delivered, channel }) como booleano y
// `{ delivered: false }` es truthy. Estos tests fijan la regla honesta y el CONTRATO de la forma.

describe("classifyDelivery: solo 'delivered' cuando llego de verdad", () => {
  it("delivered:true en canal real -> delivered", () => {
    expect(classifyDelivery({ delivered: true, channel: "instagram" })).toBe("delivered");
    expect(classifyDelivery({ delivered: true, channel: "whatsapp" })).toBe("delivered");
  });

  it("delivered:false en canal real -> failed (el bug: antes contaba como exito)", () => {
    expect(classifyDelivery({ delivered: false, channel: "instagram" })).toBe("failed");
    expect(classifyDelivery({ delivered: false, channel: "whatsapp" })).toBe("failed");
  });

  it("channel 'none' (candidata del simulador) -> simulator, ni exito ni fallo de Instagram", () => {
    expect(classifyDelivery({ delivered: false, channel: "none" })).toBe("simulator");
    // Incluso si por lo que sea viniera delivered:true con channel none, sigue siendo simulador (no hay envio real).
    expect(classifyDelivery({ delivered: true, channel: "none" })).toBe("simulator");
  });

  it("null/undefined -> not-sent (no habia nada que enviar)", () => {
    expect(classifyDelivery(null)).toBe("not-sent");
    expect(classifyDelivery(undefined)).toBe("not-sent");
  });

  it("deliveryError (la ruta capturo una excepcion al entregar) -> failed, gane a todo", () => {
    expect(classifyDelivery({ delivered: true, channel: "instagram" }, true)).toBe("failed");
    expect(classifyDelivery(null, true)).toBe("failed");
  });
});

describe("wasDeliveredToCandidate: booleano honesto para el aviso del CRM", () => {
  it("true SOLO con entrega real confirmada", () => {
    expect(wasDeliveredToCandidate({ delivered: true, channel: "instagram" })).toBe(true);
  });

  it("false cuando fallo, cuando es simulador y cuando no se envio (el fix del bug)", () => {
    expect(wasDeliveredToCandidate({ delivered: false, channel: "instagram" })).toBe(false);
    expect(wasDeliveredToCandidate({ delivered: false, channel: "none" })).toBe(false);
    expect(wasDeliveredToCandidate(null)).toBe(false);
    expect(wasDeliveredToCandidate({ delivered: true, channel: "instagram" }, true)).toBe(false);
  });
});

describe("contrato de la forma: UI y API no pueden volver a divergir", () => {
  it("SentToCandidate coincide con el shape de DecisionOutcome.sentToCandidate", () => {
    // Si alguien cambia la forma que devuelve la API (DecisionOutcome) sin actualizar el helper de la UI,
    // este assert de tipos rompe el typecheck. Es justo la divergencia que causo el bug original.
    type ApiShape = NonNullable<DecisionOutcome["sentToCandidate"]>;
    expectTypeOf<ApiShape>().toEqualTypeOf<SentToCandidate>();
  });
});
