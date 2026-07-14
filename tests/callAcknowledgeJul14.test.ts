import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallContext } from "@/application/callContext";
import type { CallUnderstander } from "@/application/callUnderstander";

// Sweep AR 14-jul (candidata que contaba su vida): cuando ella dice algo REAL que no es pregunta ni objeción
// ("hago changas con redes"), el oído determinista no lo reconoce. La comprensión lo etiqueta como "smalltalk"
// (charla/respuesta) -> se ACUSA con naturalidad (ACKNOWLEDGE), en vez del viejo `unclear` -> ASK_REPEAT que
// fingía "no te pillo". Si la comprensión devuelve "none" (de verdad no lo entiende) o null (timeout), se
// mantiene el fallback seguro `unclear` -> ASK_REPEAT (invariante 6): no fingimos entender lo que no oímos.

const CTX: CallContext = { candidateName: "Vani", concerns: [] };
const asSmalltalk: CallUnderstander = { understand: async () => "smalltalk" };
const asNone: CallUnderstander = { understand: async () => "none" };
const failed: CallUnderstander = { understand: async () => null };

async function replyToStatement(statement: string, understander: CallUnderstander) {
  const messages: CallChatMessage[] = [];
  const opener = await respondToCall({ messages, context: CTX, candidateName: "Vani", understander });
  messages.push({ role: "assistant", content: opener.content });
  messages.push({ role: "user", content: statement });
  return respondToCall({ messages, context: CTX, candidateName: "Vani", understander });
}

const STATEMENT = "hago changas con redes y fotos, nada fijo igual";

describe("acuse neutro cuando cuenta algo real (sweep AR 14-jul)", () => {
  it("comprensión 'smalltalk' (charla/respuesta) -> ACKNOWLEDGE, NUNCA finge 'no te pillo'", async () => {
    const r = await replyToStatement(STATEMENT, asSmalltalk);
    expect(r.directiveType).toBe("ACKNOWLEDGE");
    expect(r.content.trim().length).toBeGreaterThan(0);
    expect(r.content.toLowerCase()).not.toMatch(/no te he pillado|se oye entrecortado|cobertura|repit/);
  });

  it("comprensión 'none' (de verdad no lo entiende) -> ASK_REPEAT (fallback seguro, sin cambios)", async () => {
    const r = await replyToStatement(STATEMENT, asNone);
    expect(r.directiveType).toBe("ASK_REPEAT");
  });

  it("comprensión null (timeout/fallo) -> ASK_REPEAT (fallback seguro)", async () => {
    const r = await replyToStatement(STATEMENT, failed);
    expect(r.directiveType).toBe("ASK_REPEAT");
  });

  it("un ACKNOWLEDGE intercalado NO avanza ni rompe el guion (replay-safe multi-turno)", async () => {
    const messages: CallChatMessage[] = [];
    const opener = await respondToCall({ messages, context: CTX, candidateName: "Vani", understander: asSmalltalk });
    messages.push({ role: "assistant", content: opener.content });
    // "dale" -> avanza el guion (COVER_STAGE de la 1a etapa).
    messages.push({ role: "user", content: "si dale" });
    const firstCover = await respondToCall({ messages, context: CTX, candidateName: "Vani", understander: asSmalltalk });
    messages.push({ role: "assistant", content: firstCover.content });
    expect(firstCover.directiveType).toBe("COVER_STAGE");
    // Cuenta algo (smalltalk) -> ACKNOWLEDGE, que NO avanza ni cierra.
    messages.push({ role: "user", content: STATEMENT });
    const ack = await respondToCall({ messages, context: CTX, candidateName: "Vani", understander: asSmalltalk });
    messages.push({ role: "assistant", content: ack.content });
    expect(ack.directiveType).toBe("ACKNOWLEDGE");
    // Tras el ACKNOWLEDGE, un "dale" SIGUE avanzando el guion (no se estanca, no salta, no hace handoff).
    messages.push({ role: "user", content: "si dale" });
    const nextCover = await respondToCall({ messages, context: CTX, candidateName: "Vani", understander: asSmalltalk });
    expect(nextCover.directiveType).toBe("COVER_STAGE");
  });
});
