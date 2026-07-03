import { describe, expect, it } from "vitest";
import { businessKnowledgeEntries } from "@/content/business";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

// GUERRA AL "MI SOCIO" (3-jul, encargo de Alex): las candidatas preguntan de mil formas; el defer queda
// SOLO para lo desconocido E importante (contrato/impuestos/garantías). Estas preguntas REALES acababan
// en "mi socio" con la respuesta documentada delante — fallo de palabras clave del recuperador.

const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
const callCandidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "coverage_probe" }),
  currentState: "CALL_IN_PROGRESS"
});

async function covers(question: string, expectedEntryId: string): Promise<boolean> {
  const entries = await retriever.retrieve({
    candidate: callCandidate,
    intent: "REQUESTS_INFORMATION",
    question,
    limit: 3,
    ignoreStateGating: true
  });
  return entries.some((entry) => entry.id === expectedEntryId);
}

describe("recuperación: preguntas reales que antes acababan en 'mi socio'", () => {
  const CASES: Array<[string, string]> = [
    ["¿como me llega la plata a mi?", "commercial-revenue-share-settlement"],
    ["¿y si me ve mi familia?", "geo-privacy-three-layers"],
    ["¿puedo usar otro nombre?", "geo-privacy-three-layers"],
    ["¿tengo que hacer videos muy fuertes?", "content-boundaries-neutral-question"],
    ["¿la cuenta de instagram es mia o vuestra?", "content-agency-responsibilities"],
    ["¿quien contesta los mensajes de los clientes?", "services-agency-management"],
    ["¿necesito verificarme en onlyfans con mi dni?", "faq-who-opens-of-account"],
    ["¿cuando empezariamos?", "launch-timeline"],
    ["¿que significa se liquida?", "commercial-revenue-share-settlement"],
    ["¿donde estais ubicados?", "agency-profile-rose-models"],
    ["¿esto es porno o que es exactamente?", "content-boundaries-neutral-question"]
  ];
  for (const [question, entryId] of CASES) {
    it(`"${question}" -> cubre ${entryId}`, async () => {
      expect(await covers(question, entryId)).toBe(true);
    });
  }
});

describe("clasificador: preguntas personales/broma al bot -> identidad con gracia (no socio)", () => {
  for (const phrase of [
    "¿tu tambien tienes onlyfans? jaja",
    "¿estas soltero? jaja",
    "¿que hora es alli en españa?",
    "¿tienes novia?"
  ]) {
    it(`"${phrase}" -> asks-identity`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("asks-identity");
    });
  }
});

describe("lo que DEBE seguir defiriendo (desconocido E importante, política de Alex)", () => {
  const STILL_DEFER = [
    "¿y los impuestos como van alla?",
    "¿tengo que declarar esto en argentina?",
    "¿que pasa si la cuenta no crece?",
    "¿me puedes pasar alguna referencia de otra chica?"
  ];
  for (const question of STILL_DEFER) {
    it(`"${question}" -> asks-unknown (defer correcto)`, async () => {
      const entries = await retriever.retrieve({
        candidate: callCandidate,
        intent: "REQUESTS_INFORMATION",
        question,
        limit: 3,
        ignoreStateGating: true
      });
      const signal = classifyCallSignal({ utterance: question, isCoveredQuestion: entries.length > 0 });
      expect(signal).toBe("asks-unknown");
    });
  }
});
