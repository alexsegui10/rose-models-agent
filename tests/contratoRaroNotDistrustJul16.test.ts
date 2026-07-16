import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Regresión (auditoría E2E re-barrido 16-jul): "¿hay contrato raro?" / "¿el contrato tiene algo raro?" es una
// preocupación CONTRACTUAL benigna (letra pequeña/condiciones), no sospecha de estafa. El "raro" la marcaba
// como desconfianza -> soltaba el boilerplate de transparencia en vez de escalar la duda de contrato a Alex.
// Se excluye "raro" en contexto contractual (análogo a "nada raro"). "es raro/suena raro" sigue = desconfianza.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "contrato_raro", profileVisibility: "PUBLIC" }),
    firstName: "Noe",
    age: 30,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
  } as Candidate);
}

async function surfacedIds(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries.map((e) => e.id);
}

describe("'contrato raro' es contractual, no desconfianza (auditoría 16-jul)", () => {
  it("'y si me quiero salir, hay contrato raro?' NO surfacea la ficha de desconfianza", async () => {
    const ids = await surfacedIds("y si me quiero salir a los dos meses, hay contrato raro?");
    expect(ids).not.toContain("objection-distrust");
  });

  it("desconfianza REAL ('esto me suena raro, no me fio') SÍ surfacea la ficha de desconfianza", async () => {
    const ids = await surfacedIds("esto me suena raro, no me fio");
    expect(ids).toContain("objection-distrust");
  });
});
