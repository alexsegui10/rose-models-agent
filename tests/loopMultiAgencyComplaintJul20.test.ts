import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// /loop iteracion 3 (barrido, caso Carla): "con la otra agencia era un afano" recibia la ficha de
// multi-agencia ("puedes trabajar con dos agencias..."), un no-sequitur — ella cuenta un mal recuerdo, no
// pregunta si puede tener dos agencias. La QUEJA EN PASADO de una agencia ya no dispara la ficha; el caso
// PRESENTE (agencia actual) y la PREGUNTA real de multi-agencia siguen disparandola.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "ma_" + Math.random().toString().slice(2, 6) }),
    currentState: "QUALIFYING" as CandidateState
  } as unknown as Candidate);
}

async function ids(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries.map((e) => e.id);
}

describe("Multi-agencia: la queja de una agencia PASADA no dispara la ficha, pero la pregunta real sí", () => {
  const complaints = [
    "con la otra agencia era un afano, no me traian trafico",
    "la otra agencia era un desastre total",
    "la agencia que tuve me prometieron only y me mandaron a stripchat",
    "esa agencia se llevaba una barbaridad y no hacia nada"
  ];
  for (const q of complaints) {
    it(`queja pasada '${q}' NO trae la ficha de multi-agencia`, async () => {
      expect(await ids(q), q).not.toContain("multi-agency-different-traffic");
    });
  }

  const realQuestions = [
    "puedo trabajar con dos agencias a la vez?",
    "estoy con otra agencia ahora, puedo estar en las dos?",
    "se puede tener dos agencias o es exclusivo?"
  ];
  for (const q of realQuestions) {
    it(`pregunta real '${q}' SÍ trae la ficha de multi-agencia`, async () => {
      expect(await ids(q), q).toContain("multi-agency-different-traffic");
    });
  }
});
