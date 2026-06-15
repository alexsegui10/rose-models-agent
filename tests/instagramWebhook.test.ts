import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInstagramWebhookEvent, resolveWebhookChallenge, verifyWebhookSignature } from "@/application/instagramWebhook";

const APP_SECRET = "test-app-secret";
const sign = (body: string) => `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;

describe("Instagram webhook: handshake de verificacion (GET)", () => {
  it("devuelve el challenge si el verify token coincide", () => {
    const out = resolveWebhookChallenge({ mode: "subscribe", verifyToken: "secreto", challenge: "1234" }, "secreto");
    expect(out).toBe("1234");
  });

  it("rechaza (null) si el token no coincide o el modo es otro", () => {
    expect(resolveWebhookChallenge({ mode: "subscribe", verifyToken: "malo", challenge: "1234" }, "secreto")).toBeNull();
    expect(resolveWebhookChallenge({ mode: "otra", verifyToken: "secreto", challenge: "1234" }, "secreto")).toBeNull();
    expect(resolveWebhookChallenge({ mode: "subscribe", verifyToken: "x", challenge: "y" }, "")).toBeNull();
  });
});

describe("Instagram webhook: verificacion de firma HMAC (POST)", () => {
  it("acepta una firma valida", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    expect(verifyWebhookSignature(body, sign(body), APP_SECRET)).toBe(true);
  });

  it("rechaza firma invalida, ausente o con el secreto equivocado", () => {
    const body = JSON.stringify({ object: "instagram" });
    expect(verifyWebhookSignature(body, "sha256=deadbeef", APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), "otro-secreto")).toBe(false);
    // Cuerpo manipulado tras firmar -> la firma ya no cuadra.
    expect(verifyWebhookSignature(body + " ", sign(body), APP_SECRET)).toBe(false);
  });
});

describe("Instagram webhook: parseo de eventos entrantes", () => {
  function payload(messaging: unknown[]): unknown {
    return { object: "instagram", entry: [{ id: "ig-account", time: 1, messaging }] };
  }

  it("extrae mensajes de texto con IGSID y mid", () => {
    const out = parseInstagramWebhookEvent(
      payload([{ sender: { id: "IGSID_123" }, recipient: { id: "page" }, message: { mid: "m1", text: "Hola me interesa" } }])
    );
    expect(out).toEqual([{ senderId: "IGSID_123", text: "Hola me interesa", messageId: "m1" }]);
  });

  it("ignora ecos de nuestros propios envios (is_echo)", () => {
    const out = parseInstagramWebhookEvent(
      payload([{ sender: { id: "page" }, message: { mid: "m2", text: "respuesta del bot", is_echo: true } }])
    );
    expect(out).toEqual([]);
  });

  it("ignora eventos sin texto (reacciones, adjuntos, lecturas) y formas raras", () => {
    expect(parseInstagramWebhookEvent(payload([{ sender: { id: "x" }, message: { mid: "m3" } }]))).toEqual([]);
    expect(parseInstagramWebhookEvent(payload([{ sender: { id: "x" }, reaction: { emoji: "❤" } }]))).toEqual([]);
    expect(parseInstagramWebhookEvent(payload([{ message: { text: "sin sender" } }]))).toEqual([]);
    expect(parseInstagramWebhookEvent(null)).toEqual([]);
    expect(parseInstagramWebhookEvent({})).toEqual([]);
    expect(parseInstagramWebhookEvent({ entry: "no-array" })).toEqual([]);
  });

  it("maneja varios mensajes en varias entries", () => {
    const out = parseInstagramWebhookEvent({
      object: "instagram",
      entry: [
        { messaging: [{ sender: { id: "A" }, message: { mid: "a", text: "uno" } }] },
        { messaging: [{ sender: { id: "B" }, message: { mid: "b", text: "dos" } }] }
      ]
    });
    expect(out.map((m) => m.senderId)).toEqual(["A", "B"]);
  });
});
