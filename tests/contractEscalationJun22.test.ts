import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// P0 (prueba E2E de Alex 22-jun): el bot escalaba (WhatsApp + pausa) ante "que es eso de la liquidacion?"
// porque el NLU la etiquetaba ASKS_ABOUT_CONTRACT y el retriever forzaba tags de contrato/revision-humana a
// CUALQUIER pregunta de ese intent que no fuera de "proceso". Ahora solo escalan los terminos contractuales
// GENUINOS (contrato/clausula/permanencia/exclusividad/firmar/salir/baja...). Una aclaracion de pago se
// responde, no escala.

function qualifying() {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "esc_case", profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING"
  });
}

describe("Escalado de contrato: solo terminos contractuales genuinos escalan", () => {
  const retriever = new LocalBusinessKnowledgeRetriever();

  it("aclaracion de pago etiquetada ASKS_ABOUT_CONTRACT ('que es la liquidacion') NO arrastra revision humana", async () => {
    const entries = await retriever.retrieve({
      candidate: qualifying(),
      intent: "ASKS_ABOUT_CONTRACT",
      question: "que es eso de la liquidacion"
    });
    expect(entries.some((entry) => entry.requiresHumanReview)).toBe(false);
  });

  it("duda contractual GENUINA ('clausula de permanencia') SI escala a revision humana", async () => {
    const entries = await retriever.retrieve({
      candidate: qualifying(),
      intent: "ASKS_ABOUT_CONTRACT",
      question: "que pasa con la clausula de permanencia?"
    });
    expect(entries.some((entry) => entry.requiresHumanReview)).toBe(true);
  });

  it("preguntas de geografia recuperan la FAQ de paises (Alex 22-jun)", async () => {
    const g1 = await retriever.retrieve({ candidate: qualifying(), intent: "OTHER", question: "trabajan fuera de argentina?" });
    expect(g1.some((e) => e.id === "faq-target-countries")).toBe(true);
    const g2 = await retriever.retrieve({
      candidate: qualifying(),
      intent: "OTHER",
      question: "trabajais con chicas de colombia?"
    });
    expect(g2.some((e) => e.id === "faq-target-countries")).toBe(true);
  });

  it("dudas de privacidad geografica ('no quiero que en X me vean') recuperan la entrada geo-privacy", async () => {
    const p = await retriever.retrieve({
      candidate: qualifying(),
      intent: "OTHER",
      question: "no quiero que en argentina me vean, es posible?"
    });
    expect(p.some((e) => e.id === "geo-privacy-three-layers")).toBe(true);
  });
});
