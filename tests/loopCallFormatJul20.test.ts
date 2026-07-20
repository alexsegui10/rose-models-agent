import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Decisión de Alex 20-jul ("1- es teléfono"): el formato de la llamada ("¿es videollamada o teléfono?") debe
// responderse YA en la cualificación (antes solo tras el Encaja -> quedaba sin cobertura). Ficha NUEVA
// call-format-neutral: contesta el DATO (teléfono, cortita, para conocernos) SIN proponer agenda ni pedir el
// número (eso lo abre la aprobación humana, invariante 4; lo sirve call-details-after-review, que sigue gateado).

function retriever() {
  return new LocalBusinessKnowledgeRetriever();
}
function cand(state: CandidateState): Candidate {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "cf_" + Math.random().toString().slice(2, 6) }),
    age: 35,
    isAdultConfirmed: true,
    currentState: state
  } as unknown as Candidate);
}
async function top(question: string, state: CandidateState): Promise<string | null> {
  const entries = await retriever().retrieve({ candidate: cand(state), intent: "OTHER", question });
  return entries[0]?.id ?? null;
}

describe("Formato de llamada respondible en cualificación (Alex 20-jul), sin proponer agenda", () => {
  const callFormatQs = [
    "la llamada es videollamada o x telefono normal?",
    "cuanto dura la llamada esa?",
    "de q me van a hablar en la llamada?"
  ];

  for (const q of callFormatQs) {
    it(`QUALIFYING: '${q}' -> call-format-neutral`, async () => {
      expect(await top(q, "QUALIFYING")).toBe("call-format-neutral");
    });
    it(`APPROVED (post-Encaja): '${q}' -> call-details-after-review (con CTA)`, async () => {
      expect(await top(q, "APPROVED")).toBe("call-details-after-review");
    });
  }

  // Guard de AGENDA (notas del revisor 20-jul): una pregunta de CUÁNDO/horario NO es de formato -> NO surfacea
  // la ficha neutral (difiere el horario al socio pre-aprobación). Y una PETICIÓN de llamada tampoco.
  const notFormat = [
    "de que hora es la llamada que me haras?",
    "hacemos una videollamada el martes?",
    "podemos hacer una llamada?",
    "cuando me llamas?",
    "a que hora seria la llamada?"
  ];
  for (const q of notFormat) {
    it(`QUALIFYING: '${q}' NO surfacea call-format-neutral (es agenda/petición, difiere)`, async () => {
      expect(await top(q, "QUALIFYING")).not.toBe("call-format-neutral");
    });
  }

  it("el motor RESPONDE el formato (teléfono) en cualificación y NO propone agenda ni pide el número (inv. 4)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const c = normalizeCandidate({
      ...createCandidate({ instagramUsername: "cfq_" + Math.random().toString().slice(2, 6), profileVisibility: "PUBLIC" }),
      firstName: "Q",
      age: 35,
      isAdultConfirmed: true,
      deviceEligibility: "APPROVED",
      currentState: "QUALIFYING" as CandidateState
    } as unknown as Candidate);
    await repository.saveCandidate(c);
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "la llamada es videollamada o x telefono normal?" }]
    });
    const resp = r.response.toLowerCase();
    // Responde el formato:
    expect(resp).toContain("telefono normal");
    // NO propone agenda ni pide el número antes de la aprobación (invariante 4):
    expect(resp).not.toMatch(
      /agendamos|agendar|pasame (tu|el) (numero|telefono)|que dia y (a que )?hora|te llamo en un rato|quedamos/
    );
  });
});
