import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import type { KnowledgeCategory } from "@/domain/businessKnowledge";
import type { ConversationIntent } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop Fase 1b (medición con OpenAI real, 20-jul): la señal de relevancia de la IA (relevantTopics) es de
// CATEGORÍA (gruesa) y con su boost a veces PISA una respuesta específica que el código ya acierta. Caso real
// cazado en producción: "¿me sale caro para arrancar?" la IA lo marca COMMERCIAL/porcentaje y el bot sacaba la
// ficha del reparto en vez de "no hay coste para ti". Se reproduce DETERMINISTA inyectando relevantTopics.
// PRINCIPIO: la IA RESCATA nulos y PRIORIZA, pero NO debe pisar un match específico de alta confianza del código.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "ib_" + Math.random().toString().slice(2, 6) }),
    firstName: "Test",
    age: 40,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
  } as unknown as Candidate);
}

async function topWithIa(
  question: string,
  relevantTopics: KnowledgeCategory[],
  intent: ConversationIntent = "REQUESTS_INFORMATION"
): Promise<string | null> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent, question, relevantTopics });
  return entries[0]?.id ?? null;
}

describe("Fase 1b: la señal gruesa de la IA no pisa un acierto específico del código", () => {
  // El código acierta "coste de entrada" (no-cost); la IA gruesa marca COMMERCIAL. Debe ganar no-cost.
  it("'¿me sale caro para arrancar?' con IA=COMMERCIAL sigue dando faq-no-cost-to-join", async () => {
    expect(
      await topWithIa("y esto no me sale muy caro para arrancar?", ["COMMERCIAL", "OBJECTION_HANDLING"], "ASKS_ABOUT_PERCENTAGE")
    ).toBe("faq-no-cost-to-join");
  });
  it("'¿esto me cuesta algo? ¿tengo que invertir plata?' con IA=COMMERCIAL sigue dando faq-no-cost-to-join", async () => {
    expect(await topWithIa("esto me cuesta algo? tengo que invertir plata?", ["COMMERCIAL"], "ASKS_ABOUT_PERCENTAGE")).toBe(
      "faq-no-cost-to-join"
    );
  });

  // El código acierta la definición (glosario); la IA marca SERVICES. Debe ganar el glosario.
  it("'¿qué es el tráfico?' con IA=SERVICES sigue dando glossary-trafico", async () => {
    expect(await topWithIa("che y que es el trafico? no lo cacho", ["SERVICES"])).toBe("glossary-trafico");
  });

  // El código acierta el timing del pago (liquidación); la IA marca COMMERCIAL (genérico). Debe ganar liquidación.
  it("'¿cada cuánto me pagan?' con IA=COMMERCIAL sigue dando la liquidación", async () => {
    expect(await topWithIa("cada cuanto me pagan?", ["COMMERCIAL"], "ASKS_ABOUT_PERCENTAGE")).toBe(
      "commercial-revenue-share-settlement"
    );
  });

  // NO-REGRESIÓN (rescate de nulos): cuando el código NO tiene match, la IA SÍ debe rescatar por categoría.
  it("rescate: pregunta sin tags deterministas + IA=CANDIDATE_REQUIREMENTS surfacea esa categoría", async () => {
    const top = await topWithIa("y para esto qué buscan en una como yo mas o menos?", ["CANDIDATE_REQUIREMENTS"]);
    expect(top).not.toBeNull();
  });
});
