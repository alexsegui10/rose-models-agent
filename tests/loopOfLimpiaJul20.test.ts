import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Barrido de cobertura 20-jul (180 fraseos por IA): con la IA real el bot cubre el 97% de los fraseos variados
// (el regex-suelo solo el ~52%) — o sea la IA hace su trabajo. De los 5 huecos que ni la IA cubría, este es el
// único fixeable en el suelo: "abri/hice una cuenta de OF pero nunca subi/use nada" / "cuenta de OF limpia" la IA
// lo malclasificaba (creía que daba su nombre) y el regex no lo pillaba. Es el caso REAL de Daiana ("me hice mi
// cuenta de OF, la verifiqué pero nunca la usé, está limpia"). Enruta a onlyfans-existing-or-abandoned.

function candidate(): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "ofl_" + Math.random().toString().slice(2, 6) }),
    age: 34,
    isAdultConfirmed: true,
    currentState: "QUALIFYING" as CandidateState
  } as unknown as Candidate);
}

async function ids(question: string): Promise<string[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const entries = await retriever.retrieve({ candidate: candidate(), intent: "OTHER", question });
  return entries.map((e) => e.id);
}

describe("Fase cobertura: OF abierto pero sin usar / 'cuenta limpia' -> onlyfans-existing-or-abandoned", () => {
  const abandoned = [
    "abri una cuenta de OF pero nunca subi nada",
    "hice mi cuenta de of, la verifique pero nunca la use",
    "tengo una cuenta de onlyfans verificada pero limpia",
    "arme un onlyfans hace tiempo pero nunca lo toque",
    "tengo un of hecho pero esta limpio, nunca publique"
  ];
  for (const q of abandoned) {
    it(`'${q}' -> onlyfans-existing-or-abandoned`, async () => {
      expect(await ids(q)).toContain("onlyfans-existing-or-abandoned");
    });
  }

  // NO-REGRESIÓN: "cuenta ... nunca use / ... limpia" de OTRA cosa (banco, IG, tiktok, gmail) NO enruta a OF
  // (falsos positivos cazados por el revisor 20-jul: el radio de "cuenta"/"la cuenta" genéricas).
  const notOf = [
    "nunca subi tan alto en mi vida",
    "tengo la conciencia limpia",
    "abri la ventana nunca la cierro",
    "tengo una cuenta de banco pero nunca la use",
    "abri una cuenta en el banco pero nunca la use",
    "tengo una cuenta de instagram vieja que nunca use",
    "cree una cuenta de tiktok pero nunca subi nada",
    "hice una cuenta de gmail pero nunca la use",
    "la cuenta de banco esta limpia",
    "la cuenta del restaurante ya esta limpia"
  ];
  for (const q of notOf) {
    it(`no-regresión: '${q}' NO enruta a OF existente`, async () => {
      expect(await ids(q)).not.toContain("onlyfans-existing-or-abandoned");
    });
  }
});
