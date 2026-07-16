import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Regresión (auditoría E2E re-barrido 16-jul): "¿me arman/preparan la cuenta desde cero?" no casaba los
// verbos de apertura (solo abrir/crear/montar) -> se surfaceaba tiempos de lanzamiento = non-sequitur. Se
// añaden "armar/preparar/configurar" a los verbos de apertura -> surfacea el FAQ de abrir la cuenta.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "arman_cuenta", profileVisibility: "PUBLIC" }),
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

describe("'me arman la cuenta desde cero' enruta a abrir la cuenta (auditoría 16-jul)", () => {
  it("'¿ustedes me arman la cuenta desde cero?' surfacea el FAQ de abrir la cuenta, no tiempos", async () => {
    const ids = await surfacedIds("y ustedes me arman la cuenta desde cero o como?");
    expect(ids).toContain("faq-who-opens-of-account");
    expect(ids).not.toContain("launch-timeline");
  });

  it("'¿me preparan la cuenta de onlyfans?' también surfacea el FAQ de abrir la cuenta", async () => {
    const ids = await surfacedIds("me preparan la cuenta de onlyfans ustedes?");
    expect(ids).toContain("faq-who-opens-of-account");
  });
});
