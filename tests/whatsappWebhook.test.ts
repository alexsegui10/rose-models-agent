import { describe, expect, it } from "vitest";
import { parseWhatsAppWebhookEvent } from "@/application/whatsappWebhook";

// Payloads con la forma REAL de la Cloud API de WhatsApp: entry[].changes[].value.messages[].
function textPayload(from: string, body: string, id = "wamid.TEXT1") {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "34611022254", phone_number_id: "PHONE_ID" },
              messages: [{ from, id, timestamp: "1700000000", type: "text", text: { body } }]
            }
          }
        ]
      }
    ]
  };
}

describe("parseWhatsAppWebhookEvent", () => {
  it("parsea un mensaje de texto: numero, texto, wamid y phone_number_id", () => {
    const msgs = parseWhatsAppWebhookEvent(textPayload("34699111222", "  Hola, me interesa  "));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].senderId).toBe("34699111222");
    expect(msgs[0].text).toBe("Hola, me interesa");
    expect(msgs[0].messageId).toBe("wamid.TEXT1");
    expect(msgs[0].phoneNumberId).toBe("PHONE_ID");
    expect(msgs[0].attachment).toBeUndefined();
  });

  it("parsea una IMAGEN como adjunto (mediaId + mimeType) y el caption como texto", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PHONE_ID" },
                messages: [
                  {
                    from: "34699111222",
                    id: "wamid.IMG1",
                    type: "image",
                    image: { id: "MEDIA_123", mime_type: "image/jpeg", caption: "mira esta foto" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const msgs = parseWhatsAppWebhookEvent(payload);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].attachment).toEqual({ type: "image", mediaId: "MEDIA_123", mimeType: "image/jpeg", filename: undefined });
    expect(msgs[0].text).toBe("mira esta foto");
  });

  it("parsea un DOCUMENTO con su filename", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "34699111222",
                    id: "wamid.DOC1",
                    type: "document",
                    document: { id: "MEDIA_DOC", mime_type: "application/pdf", filename: "contrato.pdf" }
                  }
                ]
              }
            }
          ]
        }
      ]
    };
    const msgs = parseWhatsAppWebhookEvent(payload);
    expect(msgs[0].attachment).toEqual({
      type: "document",
      mediaId: "MEDIA_DOC",
      mimeType: "application/pdf",
      filename: "contrato.pdf"
    });
  });

  it("ignora los acuses de entrega (statuses) y formas inesperadas, sin lanzar", () => {
    const statusOnly = {
      entry: [
        {
          changes: [{ value: { metadata: { phone_number_id: "PHONE_ID" }, statuses: [{ id: "wamid.x", status: "delivered" }] } }]
        }
      ]
    };
    expect(parseWhatsAppWebhookEvent(statusOnly)).toEqual([]);
    expect(parseWhatsAppWebhookEvent(null)).toEqual([]);
    expect(parseWhatsAppWebhookEvent({})).toEqual([]);
    expect(parseWhatsAppWebhookEvent({ entry: "nope" })).toEqual([]);
  });

  it("ignora mensajes sin remitente o sin contenido util", () => {
    const noFrom = { entry: [{ changes: [{ value: { messages: [{ id: "x", type: "text", text: { body: "hola" } }] } }] }] };
    expect(parseWhatsAppWebhookEvent(noFrom)).toEqual([]);
    const unsupported = {
      entry: [{ changes: [{ value: { messages: [{ from: "34699111222", id: "y", type: "location", location: {} }] } }] }]
    };
    expect(parseWhatsAppWebhookEvent(unsupported)).toEqual([]);
  });
});
