import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { CallDraftRequest } from "@/application/callDrafter";

// 1ª LLAMADA REAL (Alba, 21-jul): "¿y el contenido por dónde se lo tengo que mandar?" -> el bot respondió
// DOS veces con los perfiles de referencia por WhatsApp (ficha equivocada) en vez de "a la carpeta de Drive".
// Ahora hay ficha SOLO-VOZ (content-delivery-drive-call) + detector del canal de entrega. En TEXTO el Drive
// sigue SIN mencionarse (orden de Alex 6-jul, caso Constanza): la ficha va gateada a CALL_IN_PROGRESS.

const opened: CallChatMessage[] = [
  { role: "system", content: "p" },
  { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" }
];

describe("entrega del contenido en la LLAMADA: responde Drive (caso Alba)", () => {
  it("'¿el contenido por dónde te lo tengo que mandar?' -> ANSWER con el hecho del Drive en el brief", async () => {
    let captured: CallDraftRequest | undefined;
    const drafter = {
      draft: async (req: CallDraftRequest) => {
        captured = req;
        return null; // fuerza el fallback determinista; aquí solo importa el conocimiento del brief
      }
    };
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿y el contenido por dónde se lo tengo que mandar?" }],
      drafter
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    const grounding = (captured?.brief.groundingFacts ?? []).join(" ").toLowerCase();
    expect(grounding).toContain("drive");
  });

  it("otras variantes del canal de entrega también cubren (no defer): 'dónde subo las fotos'", async () => {
    const res = await respondToCall({
      messages: [...opened, { role: "user", content: "¿dónde subo las fotos y los videos?" }]
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
  });
});

describe("en TEXTO el Drive sigue fuera (gateo por estado, orden 6-jul)", () => {
  it("la ficha content-delivery-drive-call NO se recupera para una candidata en QUALIFYING", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "test_text" }),
      currentState: "QUALIFYING"
    });
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "¿y el contenido por dónde te lo tengo que mandar?",
      limit: 3
    });
    expect(entries.map((e) => e.id)).not.toContain("content-delivery-drive-call");
    expect(
      entries
        .flatMap((e) => e.facts)
        .join(" ")
        .toLowerCase()
    ).not.toContain("drive");
  });

  // Revisor 23-jul (RIESGO 1): CALL_IN_PROGRESS también es un estado real del funnel de DM (candidatas
  // atascadas ahí si se pierde el webhook — por eso existe callWatchdog). Un DM en ese estado NO ve el Drive.
  it("ni siquiera con la candidata en CALL_IN_PROGRESS el TEXTO recupera la ficha del Drive", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "test_text_call" }),
      currentState: "CALL_IN_PROGRESS"
    });
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "¿y el contenido por dónde te lo tengo que mandar?",
      limit: 3
    });
    expect(entries.map((e) => e.id)).not.toContain("content-delivery-drive-call");
    expect(
      entries
        .flatMap((e) => e.facts)
        .join(" ")
        .toLowerCase()
    ).not.toContain("drive");
  });
});
