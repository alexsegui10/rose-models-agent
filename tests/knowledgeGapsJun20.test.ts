import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { createCandidate } from "@/domain/candidate";

// Huecos confirmados por Alex (jun-2026): "cuanto se gana" (depende de ti, sin cifras), "esto me
// cuesta algo?" (no se paga nada) y "que edad buscais?" (preferentemente 30-50). Contenido aprobado
// por Alex; las respuestas NUNCA dan cifras de ingresos (invariante 3) ni debilitan el bloqueo de
// menores (invariante 2: la franja 30-50 es el publico objetivo, no toca el corte de mayoria de edad).

function probeCandidate() {
  return createCandidate({ instagramUsername: "gap_probe_jun20", profileVisibility: "PUBLIC" });
}

async function retrieveFor(question: string): Promise<KnowledgeEntry[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  return retriever.retrieve({ candidate: probeCandidate(), intent: "REQUESTS_INFORMATION", question, limit: 6 });
}

describe("hueco: cuanto se gana (potencial de ingresos honesto, sin cifras)", () => {
  it("responde que depende de la modelo (constancia/calidad), sin cifra ni garantia", async () => {
    const entries = await retrieveFor("Cuanto se gana trabajando con vosotros?");
    const entry = entries.find((candidate) => candidate.id === "commercial-no-fixed-salary");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => /depende/i.test(point))).toBe(true);
    expect(entry?.approvedAnswerPoints.some((point) => /constancia|calidad/i.test(point))).toBe(true);
  });

  it("ninguna respuesta aprobada de dinero (sin salario fijo / coste) contiene cifras", () => {
    for (const id of ["commercial-no-fixed-salary", "faq-no-cost-to-join"]) {
      const entry = businessKnowledgeEntries.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      for (const point of entry!.approvedAnswerPoints) {
        expect(/\d/.test(point), `${id}: "${point}" no debe llevar cifras`).toBe(false);
      }
    }
  });
});

describe("hueco: esto me cuesta algo? (la candidata no paga nada)", () => {
  it("recupera la entrada de coste-cero para varias formas de preguntarlo", async () => {
    const variants = [
      "Esto me cuesta algo?",
      "Tengo que pagar algo para entrar?",
      "Hay que invertir dinero al principio?",
      "Es gratis trabajar con vosotros o me cobrais una cuota?"
    ];
    for (const question of variants) {
      const entries = await retrieveFor(question);
      expect(
        entries.map((entry) => entry.id),
        question
      ).toContain("faq-no-cost-to-join");
    }
  });

  it("la respuesta deja claro que no se paga nada para empezar", async () => {
    const entries = await retrieveFor("Tengo que pagar algo para entrar?");
    const entry = entries.find((candidate) => candidate.id === "faq-no-cost-to-join");
    expect(entry?.approvedAnswerPoints.some((point) => /no tienes que pagar|no pagas nada|sin coste/i.test(point))).toBe(true);
    expect(entry?.status).toBe("ACTIVE");
    expect(entry?.approvedByAlex).toBe(true);
  });
});

describe("hueco: que edad buscais? (preferentemente 30-50, caso a caso)", () => {
  it("recupera el perfil objetivo y responde con la franja de edad", async () => {
    const entries = await retrieveFor("Que edad buscais? sirve mi edad?");
    const entry = entries.find((candidate) => candidate.id === "candidate-requirements-target-profile");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => /\b30\b/.test(point))).toBe(true);
    expect(entry?.tags).toContain("age");
  });

  it("no debilita el corte de mayoria de edad: el corte de menores vive en otra entrada", () => {
    const target = businessKnowledgeEntries.find((candidate) => candidate.id === "candidate-requirements-target-profile");
    // La franja objetivo no menciona menores ni habilita <18: eso lo gobierna candidate-requirements-adult.
    expect(target?.approvedAnswerPoints.some((point) => /menor|18/i.test(point))).toBe(false);
    const adult = businessKnowledgeEntries.find((candidate) => candidate.id === "candidate-requirements-adult");
    expect(adult?.tags).toContain("adult");
  });
});
