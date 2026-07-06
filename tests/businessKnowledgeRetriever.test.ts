import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { createCandidate, type Candidate } from "@/domain/candidate";

const GEO_QUESTION = "No quiero que me vean en Argentina, se puede bloquear mi pais en Instagram y OnlyFans?";

function hirCandidate(): Candidate {
  return {
    ...createCandidate({ instagramUsername: "lead_hir_gate", profileVisibility: "PUBLIC" }),
    currentState: "HUMAN_INTERVENTION_REQUIRED"
  };
}

function geoEntry(): KnowledgeEntry {
  const entry = businessKnowledgeEntries.find((candidate) => candidate.id === "geo-privacy-three-layers");
  if (!entry) throw new Error("geo-privacy-three-layers entry missing");
  return entry;
}

describe("LocalBusinessKnowledgeRetriever state gating in HUMAN_INTERVENTION_REQUIRED", () => {
  it("does not bypass allowedStates for entries scoped to other states", async () => {
    const scopedElsewhere: KnowledgeEntry = {
      ...geoEntry(),
      id: "geo-synthetic-scoped",
      allowedStates: ["CALL_SCHEDULED"]
    };
    const retriever = new LocalBusinessKnowledgeRetriever([scopedElsewhere]);

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries).toHaveLength(0);
  });

  it("still serves entries that explicitly allow HUMAN_INTERVENTION_REQUIRED", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries.map((entry) => entry.id)).toContain("geo-privacy-three-layers");
  });

  it("serves entries with an empty allowedStates list in any state, including HIR", async () => {
    const unrestricted: KnowledgeEntry = {
      ...geoEntry(),
      id: "geo-synthetic-unrestricted",
      allowedStates: []
    };
    const retriever = new LocalBusinessKnowledgeRetriever([unrestricted]);

    const entries = await retriever.retrieve({
      candidate: hirCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: GEO_QUESTION
    });

    expect(entries.map((entry) => entry.id)).toContain("geo-synthetic-unrestricted");
  });
});

// Bug grave de Alex (23-jun): "Holaaa / Me dais info" -> el bot reformulaba el opener (OpenAI) y ni pedia el
// nombre. Causa: "me dais info" hacia MATCH con el regex de NEGOCIACION ("me dais"/"dame") -> tags
// percentage/revenue-share/sensitive -> surfaceaba el 70/30 (ademas riesgo de invariante 3) -> al haber
// answerFacts se desactivaba el opener canonico. Una peticion GENERICA de info no es negociacion del %.
describe("Retriever: 'me dais/dame info' es peticion generica, NO negociacion del % (Alex 23-jun)", () => {
  function newLead(): Candidate {
    return createCandidate({ instagramUsername: "lead_info", profileVisibility: "PUBLIC" });
  }

  it("'me dais info' NO surfacea el reparto 70/30 (no es negociacion; invariante 3)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: newLead(),
      intent: "REQUESTS_INFORMATION",
      question: "Holaaa me dais info"
    });
    const ids = entries.map((entry) => entry.id);
    expect(ids.some((id) => id.startsWith("commercial-revenue-share") || id === "commercial-why-agency-70")).toBe(false);
  });

  it("'dame info / mas detalles' tampoco surfacea el reparto", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    for (const question of ["dame info porfa", "me podeis dar mas detalles?"]) {
      const entries = await retriever.retrieve({ candidate: newLead(), intent: "REQUESTS_INFORMATION", question });
      expect(entries.some((entry) => entry.tags.includes("revenue-share"))).toBe(false);
    }
  });

  it("'me puedes llamar anita' (apodo) NO surfacea el conocimiento de la llamada (no propone agendar)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const qualifying = { ...newLead(), currentState: "QUALIFYING" } as Candidate;
    for (const naming of ["pero me puedes llamar anita", "llamame anita porfa", "me llaman lola"]) {
      const entries = await retriever.retrieve({ candidate: qualifying, intent: "OTHER", question: naming });
      expect(entries.some((e) => e.tags.includes("call") || e.tags.includes("schedule"))).toBe(false);
    }
  });

  it("el conocimiento de la llamada SOLO se sirve tras el Encaja (Alex 5-jul, caso Yesica)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    // En QUALIFYING (sin Encaja) las preguntas por la llamada NO reciben el conocimiento de agenda:
    // el redactor proponia "si me dices un dia y una hora la agendamos" sin el OK de Alex.
    const qualifying = { ...newLead(), currentState: "QUALIFYING" } as Candidate;
    for (const phone of ["la llamada es por whatsapp?", "cuando me vais a llamar?", "me llamais por telefono?"]) {
      const entries = await retriever.retrieve({ candidate: qualifying, intent: "REQUESTS_INFORMATION", question: phone });
      expect(
        entries.some((e) => e.id === "call-details-after-review"),
        phone
      ).toBe(false);
    }
    // Con el Encaja dado (COLLECTING_CALL_DETAILS) SI se sirve.
    const approved = { ...newLead(), currentState: "COLLECTING_CALL_DETAILS", humanFitDecision: "APPROVED" } as Candidate;
    const entries = await retriever.retrieve({
      candidate: approved,
      intent: "REQUESTS_INFORMATION",
      question: "la llamada es por whatsapp?"
    });
    expect(entries.some((e) => e.id === "call-details-after-review")).toBe(true);
  });

  it("dudas de ENCAJE por edad ('49 es demasiado?', 'sirvo para esto?') surfacean el perfil objetivo (no se ignoran)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const qualifying = { ...newLead(), currentState: "QUALIFYING" } as Candidate;
    for (const fit of [
      "49 es demasiado?",
      "sirvo para esto a mi edad?",
      "soy demasiado mayor para esto?",
      "no soy demasiada para vosotros?"
    ]) {
      const entries = await retriever.retrieve({ candidate: qualifying, intent: "OTHER", question: fit });
      expect(entries.some((e) => e.id === "candidate-requirements-target-profile")).toBe(true);
    }
  });

  it("una pregunta de DINERO ('es mucho dinero?') NO se confunde con duda de encaje por edad", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const qualifying = { ...newLead(), currentState: "QUALIFYING" } as Candidate;
    const entries = await retriever.retrieve({
      candidate: qualifying,
      intent: "REQUESTS_INFORMATION",
      question: "es mucho dinero?"
    });
    expect(entries.some((e) => e.id === "candidate-requirements-target-profile")).toBe(false);
  });

  it("una negociacion REAL del % SIGUE surfaceando el reparto sensible (deteccion intacta, invariante 3)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    for (const question of [
      "me dais un 40%?",
      "podemos negociar el reparto?",
      "me hariais una excepcion con el porcentaje?",
      "me dais mas info sobre el reparto?"
    ]) {
      const entries = await retriever.retrieve({ candidate: newLead(), intent: "ASKS_ABOUT_PERCENTAGE", question });
      expect(entries.some((entry) => entry.tags.includes("revenue-share"))).toBe(true);
    }
  });
});

// Re-sonda 4-jul, caso Romy: contando su historia ("me dejo sola y despues me bloqueo") disparaba la
// respuesta enlatada de geo-bloqueo de paises a una pregunta que ella NUNCA hizo. "bloqueo" (de "me
// bloqueo") es SU historia personal, no una duda de privacidad.
describe("Retriever: 'me bloqueo' (historia personal) NO es la duda de geo-privacidad (caso Romy)", () => {
  function qualifying(): Candidate {
    return { ...createCandidate({ instagramUsername: "romy", profileVisibility: "PUBLIC" }), currentState: "QUALIFYING" };
  }

  it("'me dejo sola y despues me bloqueo' NO surfacea la respuesta de geo-bloqueo", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    for (const story of [
      "me dejo sola y despues me bloqueo",
      "la que me vendio el curso me bloqueo",
      "me han bloqueado sin avisar",
      "me bloquearon del grupo"
    ]) {
      const entries = await retriever.retrieve({ candidate: qualifying(), intent: "OTHER", question: story });
      expect(
        entries.some((entry) => entry.id === "geo-privacy-three-layers"),
        story
      ).toBe(false);
    }
  });

  it("la pregunta REAL de privacidad SIGUE surfaceando la respuesta de geo-bloqueo (sin regresion)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    for (const question of [
      "se puede bloquear mi pais para que no me vean?",
      "pueden bloquear Argentina?",
      "quiero que bloqueen a la gente de mi pais"
    ]) {
      const entries = await retriever.retrieve({ candidate: qualifying(), intent: "REQUESTS_INFORMATION", question });
      expect(
        entries.some((entry) => entry.id === "geo-privacy-three-layers"),
        question
      ).toBe(true);
    }
  });
});
