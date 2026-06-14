import { describe, expect, it } from "vitest";
import { parseAnonymizedConversationJson } from "@/application/conversationImport";

// Regresion auditoria #2: el gate de PII (invariante 5) ignoraba el campo anonymizedPersonalData,
// justo el que promete anonimizacion. PII real ahi debe rechazar la importacion igual que en mensajes.

function fileWith(anonymizedPersonalData: Record<string, string>): string {
  return JSON.stringify({
    version: "1",
    conversations: [
      {
        id: "conv-pii",
        status: "RAW_REAL",
        source: "ANONYMIZED_JSON",
        purpose: "EVALUATION",
        stateBefore: "NEW_LEAD",
        messages: [{ role: "candidate", content: "hola me interesa" }],
        anonymizedPersonalData
      }
    ]
  });
}

describe("conversationImport: el gate de PII tambien cubre anonymizedPersonalData", () => {
  it("rechaza un telefono real en anonymizedPersonalData", () => {
    expect(() => parseAnonymizedConversationJson(fileWith({ phone: "+34 612 345 678" }))).toThrow(/personal data/i);
  });

  it("rechaza un email real en anonymizedPersonalData", () => {
    expect(() => parseAnonymizedConversationJson(fileWith({ email: "real@empresa.com" }))).toThrow(/personal data/i);
  });

  it("rechaza un handle real en anonymizedPersonalData", () => {
    expect(() => parseAnonymizedConversationJson(fileWith({ instagram: "@realhandle" }))).toThrow(/personal data/i);
  });

  it("acepta placeholders anonimizados (ANON_PHONE)", () => {
    expect(() => parseAnonymizedConversationJson(fileWith({ phone: "ANON_PHONE", email: "ANON_EMAIL" }))).not.toThrow();
  });
});

function fileWithExtra(extra: Record<string, unknown>): string {
  return JSON.stringify({
    version: "1",
    conversations: [
      {
        id: "conv-extra",
        status: "RAW_REAL",
        source: "ANONYMIZED_JSON",
        purpose: "EVALUATION",
        stateBefore: "NEW_LEAD",
        messages: [{ role: "candidate", content: "hola me interesa" }],
        ...extra
      }
    ]
  });
}

describe("conversationImport: el gate de PII tambien cubre el texto libre que se persiste", () => {
  it("rechaza PII en idealNextResponse (se vuelca a ejemplos de generacion)", () => {
    expect(() => parseAnonymizedConversationJson(fileWithExtra({ idealNextResponse: "Escribeme al +34 612 345 678" }))).toThrow(
      /personal data/i
    );
  });

  it("rechaza PII en notes", () => {
    expect(() => parseAnonymizedConversationJson(fileWithExtra({ notes: "Contacto real@empresa.com" }))).toThrow(
      /personal data/i
    );
  });

  it("rechaza PII en originalAlexResponses", () => {
    expect(() =>
      parseAnonymizedConversationJson(fileWithExtra({ originalAlexResponses: ["Te paso mi insta @realhandle"] }))
    ).toThrow(/personal data/i);
  });

  it("acepta texto libre limpio", () => {
    expect(() =>
      parseAnonymizedConversationJson(fileWithExtra({ idealNextResponse: "Genial, cuentame un poco de ti", notes: "buena lead" }))
    ).not.toThrow();
  });
});
