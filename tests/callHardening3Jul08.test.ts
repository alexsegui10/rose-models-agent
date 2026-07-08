import { describe, it, expect } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// Lote 3 (sweep 8-jul): "¿quién gestiona el Instagram?" es una pregunta de PROCESO cubierta (la gestiona la
// agencia), pero el recuperador no la keyeaba y se defería a WhatsApp como desconocida. Fix en tagsFromInput.

const OPENING = "Hola Lucia, soy Alex, de Rose Models. Te cuento como trabajamos, ¿vale?";

describe("Lote 3: gestión de la cuenta/IG -> cubierto (no deferir)", () => {
  it("responder: '¿quién gestiona el instagram?' -> ANSWER_FROM_KNOWLEDGE (cubierto), no DEFER", async () => {
    const messages: CallChatMessage[] = [
      { role: "assistant", content: OPENING },
      { role: "user", content: "oye y el instagram ese quien lo gestiona" }
    ];
    const res = await respondToCall({ messages, candidateName: "Lucia" });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
  });

  it("variantes de gestión de la cuenta se cubren", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "call_ctx" }),
      currentState: "CALL_IN_PROGRESS"
    });
    for (const question of [
      "quien gestiona el instagram",
      "quien lleva las cuentas",
      "quien maneja mi perfil",
      "vosotros administrais el instagram?"
    ]) {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question,
        limit: 3,
        ignoreStateGating: true
      });
      expect(entries.length, `"${question}" deberia estar cubierta`).toBeGreaterThan(0);
    }
  });

  it("CONTROL (guard de dinero): 'gestiona el dinero' NO se surfacea por la regla de servicios/IG", async () => {
    // El guard !/dinero.../ evita que la nueva regla pise el control de pagos. Verificamos que la entrada de
    // servicios/agencia (la que responde "quien gestiona el instagram") NO aparece para una pregunta de dinero.
    const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "call_ctx" }),
      currentState: "CALL_IN_PROGRESS"
    });
    const igEntries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "quien gestiona el instagram",
      limit: 3,
      ignoreStateGating: true
    });
    const serviceEntryId = igEntries[0]?.id;
    expect(serviceEntryId).toBeTruthy();
    const moneyEntries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "y quien gestiona el dinero exactamente",
      limit: 3,
      ignoreStateGating: true
    });
    // La entrada de servicios/IG NO debe ser la respuesta a una pregunta de DINERO (la regla no se disparó).
    expect(moneyEntries[0]?.id).not.toBe(serviceEntryId);

    // Y una PETICION DE PRUEBAS ("ensename las cuentas que llevais") tampoco: debe seguir escalando, no
    // responderse como servicios (el guard excluye ensena/ver/resultados).
    const proofEntries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "ensename las cuentas que llevais para ver resultados",
      limit: 3,
      ignoreStateGating: true
    });
    expect(proofEntries[0]?.id).not.toBe(serviceEntryId);
  });
});
