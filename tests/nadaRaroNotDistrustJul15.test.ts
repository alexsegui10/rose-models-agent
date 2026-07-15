import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Regresión (auditoría E2E 15-jul, voz): la regex de desconfianza casaba "raro" incluso en "NADA raro"
// (descriptor benigno de contenido), empujando el tag "objection" y volcando el bloque de privacidad/geo
// sin venir a cuento. "es raro / suena raro" (desconfianza real) SIGUE disparándolo.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "raro_test", profileVisibility: "PUBLIC" }),
    firstName: "Sol",
    age: 31,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
  } as Candidate);
}

async function surfacedIds(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries.map((e) => e.id);
}

describe("'nada raro' no es desconfianza (auditoría 15-jul, voz)", () => {
  it("'es nada raro, tranqui' NO surfacea la ficha de desconfianza", async () => {
    const ids = await surfacedIds("es nada raro, tranqui, es contenido normal");
    expect(ids).not.toContain("objection-distrust");
  });

  it("desconfianza REAL ('esto es re raro, me da mala espina') SÍ surfacea la ficha de desconfianza", async () => {
    const ids = await surfacedIds("esto es re raro, me da mala espina");
    expect(ids).toContain("objection-distrust");
  });
});
