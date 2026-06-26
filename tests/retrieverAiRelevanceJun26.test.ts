import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import type { KnowledgeCategory } from "@/domain/businessKnowledge";

// PASO 6 (Alex 26-jun): cuando la IA marca relevantTopics, se FILTRA el CONTENIDO de categorias que la IA NO
// marco relevante (mata el "habla de algo que no le preguntaron" por un regex de mas). Las categorias de
// SEGURIDAD/SENSIBLE/ESCALADA (COMMERCIAL, CONTRACT_POLICY, ESCALATION_POLICY, OBJECTION_HANDLING) quedan EXENTAS
// (su surfaceo + el gating del % siguen deterministas, invariantes 3/4). Sin relevantTopics, el regex manda.

const retriever = new LocalBusinessKnowledgeRetriever();
const candidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "rel_test", profileVisibility: "PUBLIC" }),
  firstName: "Ana",
  age: 30,
  isAdultConfirmed: true,
  currentState: "QUALIFYING" as CandidateState
});

async function categoriesFor(question: string, relevantTopics?: KnowledgeCategory[]): Promise<KnowledgeCategory[]> {
  const entries = await retriever.retrieve({ candidate, intent: "REQUESTS_INFORMATION", question, relevantTopics });
  return entries.map((entry) => entry.category);
}

describe("Filtro de relevancia por IA en el retriever (Paso 6, Alex 26-jun)", () => {
  it("SIN relevantTopics el regex manda (modo determinista no filtra: comportamiento de siempre)", async () => {
    const cats = await categoriesFor("que servicios ofreceis y como me promocionais");
    expect(cats).toContain("SERVICES");
    // un cross-category que el regex surfacea (AGENCY_PROFILE) sigue apareciendo sin la opinion de la IA
    expect(cats).toContain("AGENCY_PROFILE");
  });

  it("CON relevantTopics se filtra el CONTENIDO de categorias no marcadas (cross-category fuera)", async () => {
    const cats = await categoriesFor("que servicios ofreceis y como me promocionais", ["SERVICES"]);
    expect(cats).toContain("SERVICES");
    expect(cats).not.toContain("AGENCY_PROFILE"); // la IA solo marco SERVICES -> AGENCY_PROFILE se descarta
  });

  it("COMMERCIAL es EXENTA: surfacea aunque la IA no la marque (el % se gatea en el planner, invariante 3)", async () => {
    const cats = await categoriesFor("dame un 40% o me voy", ["CANDIDATE_REQUIREMENTS"]);
    expect(cats).toContain("COMMERCIAL");
  });

  it("ESCALADA/OBJECCION son EXENTAS: la desconfianza surfacea aunque la IA marque otra cosa (invariante 4)", async () => {
    const cats = await categoriesFor("esto es una estafa no me fio de vosotros", ["SERVICES"]);
    expect(cats.some((c) => c === "ESCALATION_POLICY" || c === "OBJECTION_HANDLING")).toBe(true);
  });

  it("la categoria de CONTENIDO que la IA SI marca surfacea", async () => {
    const cats = await categoriesFor("que servicios ofreceis", ["SERVICES"]);
    expect(cats).toContain("SERVICES");
  });
});
