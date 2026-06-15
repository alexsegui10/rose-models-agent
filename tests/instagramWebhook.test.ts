import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseInstagramWebhookEvent,
  resolveWebhookChallenge,
  secretFingerprint,
  verifyWebhookSignature
} from "@/application/instagramWebhook";

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
  it("acepta una firma valida (string)", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    expect(verifyWebhookSignature(body, sign(body), APP_SECRET)).toEqual({ valid: true, matchedIndex: 0 });
  });

  it("acepta una firma valida hasheando los BYTES crudos (Buffer), igual que sobre el string", () => {
    const body = JSON.stringify({ object: "instagram", entry: [{ texto: "acentos áéí y emoji 🌹" }] });
    const buf = Buffer.from(body, "utf8");
    expect(verifyWebhookSignature(buf, sign(body), APP_SECRET)).toEqual({ valid: true, matchedIndex: 0 });
  });

  it("rechaza firma invalida, ausente o con el secreto equivocado", () => {
    const body = JSON.stringify({ object: "instagram" });
    expect(verifyWebhookSignature(body, "sha256=deadbeef", APP_SECRET).valid).toBe(false);
    expect(verifyWebhookSignature(body, null, APP_SECRET).valid).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), "otro-secreto").valid).toBe(false);
    expect(verifyWebhookSignature(body, sign(body), []).valid).toBe(false);
    // Cuerpo manipulado tras firmar -> la firma ya no cuadra.
    expect(verifyWebhookSignature(body + " ", sign(body), APP_SECRET).valid).toBe(false);
  });

  it("prueba varios secretos candidatos y devuelve el indice del que cuadra", () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    // El correcto es el segundo de la lista (simula: el ALT era el bueno).
    const out = verifyWebhookSignature(body, sign(body), ["secreto-malo", APP_SECRET]);
    expect(out).toEqual({ valid: true, matchedIndex: 1 });
    // Si ninguno cuadra -> invalido.
    expect(verifyWebhookSignature(body, sign(body), ["malo-1", "malo-2"]).valid).toBe(false);
  });
});

describe("Instagram webhook: huella de secreto (diagnostico sin filtrar)", () => {
  it("es estable, no reversible y distingue secretos distintos", () => {
    expect(secretFingerprint(APP_SECRET)).toBe(secretFingerprint(APP_SECRET));
    expect(secretFingerprint(APP_SECRET)).not.toBe(secretFingerprint("otro-secreto"));
    // No revela el secreto: corta (12 chars hex) y no lo contiene.
    expect(secretFingerprint(APP_SECRET)).toMatch(/^[0-9a-f]{12}$/);
    expect(secretFingerprint(APP_SECRET)).not.toContain(APP_SECRET);
    expect(secretFingerprint("")).toBe("vacio");
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
