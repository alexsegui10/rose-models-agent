import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Barrido de voz 20-jul (over-defer, decisión de Alex: la voz responde cómo se crea el OF): "no tengo OF, ¿me
// lo armáis?" quedaba SIN cobertura (el patrón de quién-abre-la-cuenta solo tenía "me LA arm/abr/cre" y no
// captaba "me LO arman" —masculino, el OnlyFans— ni "of" a secas en el orden inverso). Ahora enruta a
// faq-who-opens-of-account (la creas tú, te guiamos). Retriever COMPARTIDO texto+voz: mismo significado en ambos.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "cofs_" + Math.random().toString().slice(2, 6) }),
    age: 30,
    isAdultConfirmed: true,
    currentState: "APPROVED" as CandidateState
  } as unknown as Candidate);
}

async function ids(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({
    candidate: candidate(),
    intent: "REQUESTS_INFORMATION",
    question,
    limit: 3,
    ignoreStateGating: true
  });
  return entries.map((e) => e.id);
}

describe("Over-defer voz: 'no tengo OF, ¿me lo armáis?' -> quién crea el OF (no defer)", () => {
  for (const q of [
    "no tengo onlyfans, me lo arman ustedes?",
    "no tengo of, me lo armais vosotros?",
    "no tengo of pero me lo abren ustedes?",
    "la cuenta me la abro yo o me lo abren ustedes?"
  ]) {
    it(`'${q}' -> faq-who-opens-of-account`, async () => {
      expect(await ids(q)).toContain("faq-who-opens-of-account");
    });
  }

  // NO-REGRESIÓN: incredulidad "no me lo/la creo" (creer, no crear) NO enruta a of-account (nota revisor 20-jul).
  for (const q of [
    "eso de la cuenta no me lo creo",
    "la cuenta esa no me la creo ni loca",
    "lo del of no me lo creo la verdad"
  ]) {
    it(`no-regresión incredulidad: '${q}' NO enruta a of-account`, async () => {
      expect(await ids(q)).not.toContain("faq-who-opens-of-account");
    });
  }

  // NO-REGRESIÓN: "me lo X" sin OF/cuenta no enruta ahí.
  for (const q of ["me lo dijeron ustedes", "no tengo tiempo, me lo organizan?"]) {
    it(`no-regresión: '${q}' NO enruta a of-account`, async () => {
      expect(await ids(q)).not.toContain("faq-who-opens-of-account");
    });
  }
});
