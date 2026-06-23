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

  it("'¿la cuenta de OF la abro yo o vosotros?' recupera faq-who-opens-of-account y NO escala (Alex 23-jun)", async () => {
    const e = await retriever.retrieve({
      candidate: qualifying(),
      intent: "REQUESTS_INFORMATION",
      question: "La cuenta la tengo que abrir yo o vosotros me la abris?"
    });
    expect(e.some((entry) => entry.id === "faq-who-opens-of-account")).toBe(true);
    expect(e.some((entry) => entry.requiresHumanReview)).toBe(false);
  });

  it("variante '¿me la monta la agencia la cuenta?' tambien recupera la entrada (no re-escala)", async () => {
    const e = await retriever.retrieve({
      candidate: qualifying(),
      intent: "OTHER",
      question: "y me la monta la agencia la cuenta o como?"
    });
    expect(e.some((entry) => entry.id === "faq-who-opens-of-account")).toBe(true);
  });

  it("'¿abrir una cuenta de banco?' se trata como PAGO, no como abrir la cuenta de OF (no es el resultado principal)", async () => {
    const e = await retriever.retrieve({
      candidate: qualifying(),
      intent: "OTHER",
      question: "tengo que abrir una cuenta de banco para cobrar?"
    });
    // El guard no etiqueta of-account para una cuenta de BANCO; el resultado mas relevante es de pago, no la
    // entrada de abrir la cuenta de OF (que, si aparece, es por solapamiento de palabras y queda por debajo).
    expect(e[0]?.id).not.toBe("faq-who-opens-of-account");
    expect(e.some((entry) => entry.tags.includes("payment") || entry.tags.includes("salary"))).toBe(true);
  });
});
