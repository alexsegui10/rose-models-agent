import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";

// Conversación REAL de producción que reportó Alex (20-jul, caso Lilly): brasileña en Buenos Aires que pregunta
// por su GEO ("mi perfil solo muestra afuera? no me gustaria acceso de latam"). Ese fraseo NO lo captaba el
// detector de geo-privacidad -> retriever VACÍO -> "sin cobertura" -> el bot rellenaba con un NON-SEQUITUR
// (definición de "chatter" por la cara) + REPETÍA el pitch ("Vale pues, te voy a explicar de forma breve...").
// Ahora su pregunta enruta a geo-privacy-three-layers y se RESPONDE (identidad española / no se puede geo-blocar
// Instagram pero va con esa identidad). Regla de Alex: el bot no rellena con fragmentos lo que no entiende.

function retriever() {
  return new LocalBusinessKnowledgeRetriever();
}

function candidateWithPitch(): Candidate {
  const now = new Date().toISOString();
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: "lilly_" + Math.random().toString().slice(2, 6), profileVisibility: "PUBLIC" }),
    firstName: "Lilly",
    age: 30,
    isAdultConfirmed: true,
    deviceModel: "iPhone 16 Pro",
    deviceEligibility: "APPROVED",
    currentState: "WAITING_HUMAN_REVIEW" as CandidateState,
    conversationHistory: [
      {
        role: "agent",
        content: "Vale pues, te voy a explicar de forma breve como trabajamos: tu solo te encargas de mandar el contenido.",
        timestamp: now
      },
      {
        role: "agent",
        content: "Voy a comentar tu perfil con mi socio para valorarlo bien y te digo algo en cuanto lo hayamos revisado.",
        timestamp: now
      }
    ]
  } as unknown as Candidate);
}

const LILLY_GEO = "Mi perfil solo muestra afuera? Soy brasileira e vivo por ahora en Buenos Aires no me gustaria acceso de latam";

describe("Caso real Lilly (prod 20-jul): la pregunta de geo/latam se responde, no se rellena con chatter/pitch", () => {
  it("el retriever enruta su geo a geo-privacy-three-layers (no chatter ni pitch de servicios)", async () => {
    const cand = candidateWithPitch();
    const entries = await retriever().retrieve({ candidate: cand, intent: "OTHER", question: LILLY_GEO });
    const ids = entries.map((e) => e.id);
    expect(ids[0]).toBe("geo-privacy-three-layers");
    expect(ids).not.toContain("glossary-chatter");
    expect(ids).not.toContain("services-agency-management");
  });

  it("el motor RESPONDE su geo (identidad española / bloqueo) y NO suelta chatter ni repite el pitch", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
      exampleRetriever: new LocalExampleRetriever(),
      automationMode: "AUTOMATIC"
    });
    const cand = candidateWithPitch();
    await repository.saveCandidate(cand);
    const r = await engine.handleIncomingTurn({ instagramUsername: cand.instagramUsername, messages: [{ content: LILLY_GEO }] });
    const resp = r.response.toLowerCase();
    // Responde su geo (la ficha habla de identidad española / no se puede bloquear el país en IG).
    expect(resp).toMatch(/identidad espanola|bloquear el pais|otra identidad|con tu imagen/);
    // NO el non-sequitur del chatter ni la RE-explicación del pitch.
    expect(resp).not.toContain("un chatter es una persona");
    expect(resp).not.toContain("te voy a explicar de forma breve como trabajamos");
  });

  // Variantes del mismo fraseo geo-región (barrido 20-jul) que antes quedaban sin cobertura.
  const geoPhrasings = [
    "no me gustaria acceso de latam",
    "mi perfil solo se muestra afuera?",
    "que no tenga acceso la gente de aca",
    "solo que se vea en españa"
  ];
  for (const q of geoPhrasings) {
    it(`'${q}' enruta a geo-privacidad`, async () => {
      const entries = await retriever().retrieve({ candidate: candidateWithPitch(), intent: "OTHER", question: q });
      expect(entries.map((e) => e.id)).toContain("geo-privacy-three-layers");
    });
  }

  // NO-REGRESIÓN: fraseos con "afuera/solo/acceso/se vea" que NO son geo-privacidad no deben enrutar ahí
  // (falsos positivos cazados por el revisor 20-jul, incluido el crítico que robaba el turno a la CARA).
  const notGeo = [
    "yo laburo solo afuera de casa",
    "me muestra mejor de perfil que de frente",
    "no quiero que se vea mi cara",
    "no quiero que se vea mal mi contenido",
    "no tengo buen acceso a internet aca",
    "mi cuenta solo la uso fuera de casa",
    "el contenido solo se sube fuera de horario",
    "fuera de mi zona de confort no me animo"
  ];
  for (const q of notGeo) {
    it(`no-regresión: '${q}' NO enruta a geo-privacidad`, async () => {
      const entries = await retriever().retrieve({ candidate: candidateWithPitch(), intent: "OTHER", question: q });
      expect(entries.map((e) => e.id)).not.toContain("geo-privacy-three-layers");
    });
  }

  // Y el caso crítico: "no quiero que se vea mi cara" debe seguir yendo a la ficha de la CARA.
  it("'no quiero que se vea mi cara' -> ficha de la cara (no geo)", async () => {
    const entries = await retriever().retrieve({
      candidate: candidateWithPitch(),
      intent: "OTHER",
      question: "no quiero que se vea mi cara"
    });
    expect(entries[0]?.id).toBe("face-requirement-mandatory");
  });
});
