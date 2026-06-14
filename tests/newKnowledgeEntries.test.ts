import { describe, expect, it } from "vitest";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { createCandidate } from "@/domain/candidate";

const NEW_ACTIVE_ENTRY_IDS = [
  "geo-privacy-three-layers",
  "face-requirement-mandatory",
  "multi-agency-different-traffic",
  "services-secondary-traffic",
  // Promovidas de DRAFT a ACTIVE el 2026-06-11 con las respuestas confirmadas por Alex:
  "launch-timeline",
  "faq-selection-process",
  "faq-target-countries"
];

const PROMOTED_BAIT_QUESTIONS = [
  "Cual es el proceso de seleccion?",
  "A que paises vendeis el contenido?",
  "El lanzamiento es a las 2 o 3 semanas o a los 30 dias?"
];

function probeCandidate() {
  return createCandidate({ instagramUsername: "knowledge_probe", profileVisibility: "PUBLIC" });
}

async function retrieveFor(question: string, includeDrafts = false): Promise<KnowledgeEntry[]> {
  const retriever = new LocalBusinessKnowledgeRetriever();
  return retriever.retrieve({ candidate: probeCandidate(), intent: "REQUESTS_INFORMATION", question, includeDrafts, limit: 6 });
}

describe("new knowledge entries from real conversation synthesis (2026-06-10)", () => {
  it("registers the new active entries with honest escalation conditions and allowed states", () => {
    for (const id of NEW_ACTIVE_ENTRY_IDS) {
      const entry = businessKnowledgeEntries.find((candidate) => candidate.id === id);
      expect(entry, id).toBeDefined();
      expect(entry?.status, id).toBe("ACTIVE");
      expect(entry?.approvedByAlex, id).toBe(true);
      expect(entry?.escalationConditions.length, id).toBeGreaterThan(0);
      expect(entry?.allowedStates.length, id).toBeGreaterThan(0);
    }
  });

  it("retrieves the geo privacy three-layer entry for the Argentina visibility objection", async () => {
    const entries = await retrieveFor("No quiero que me vean en Argentina, se puede bloquear mi pais en Instagram y OnlyFans?");

    const entry = entries.find((candidate) => candidate.id === "geo-privacy-three-layers");
    expect(entry).toBeDefined();
    expect(entry?.prohibitedClaims.some((claim) => claim.includes("Instagram") && claim.includes("no es posible"))).toBe(true);
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("Pinterest"))).toBe(true);
    expect(entry?.approvedAnswerPoints.some((point) => point.toLowerCase().includes("identidad espanola"))).toBe(true);
  });

  it("retrieves the face requirement entry when the candidate refuses to show her face", async () => {
    const entries = await retrieveFor("No quiero hacer contenido ensenando la cara, puedo trabajar en anonimato?");

    const entry = entries.find((candidate) => candidate.id === "face-requirement-mandatory");
    expect(entry).toBeDefined();
    expect(entry?.prohibitedClaims.some((claim) => claim.toLowerCase().includes("anonimo"))).toBe(true);
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("no podemos trabjar contigo lamentablemente"))).toBe(true);
  });

  it("retrieves the multi-agency entry and asks about the traffic of the other agencies", async () => {
    const entries = await retrieveFor("Ya trabajo con otra agencia, se puede trabajar con dos agencias a la vez?");

    const entry = entries.find((candidate) => candidate.id === "multi-agency-different-traffic");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("trafico espanol las otras agencias"))).toBe(true);
    expect(entry?.facts.some((fact) => fact.includes("mismo trafico"))).toBe(true);
  });

  it("retrieves the secondary traffic entry with the four real Drive folders", async () => {
    const entries = await retrieveFor("Que haceis con el trafico, usais mas redes aparte de Instagram?");

    const entry = entries.find((candidate) => candidate.id === "services-secondary-traffic");
    expect(entry).toBeDefined();
    expect(
      entry?.approvedAnswerPoints.some(
        (point) =>
          point.includes("Fotos Only") &&
          point.includes("Videos Only") &&
          point.includes("Fotos Insta") &&
          point.includes("Videos Insta")
      )
    ).toBe(true);
    expect(entry?.facts.some((fact) => fact.includes("Telegram") && fact.includes("Twitter"))).toBe(true);
  });

  it("answers the launch timeline with the 30-day figure Alex confirmed", async () => {
    const entries = await retrieveFor("El lanzamiento es a las 2 o 3 semanas o a los 30 dias?");

    const entry = entries.find((candidate) => candidate.id === "launch-timeline");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("30 dias"))).toBe(true);
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("crece muy rapido"))).toBe(true);
    expect(entry?.prohibitedClaims.some((claim) => claim.includes("2 o 3 semanas"))).toBe(true);
  });

  it("answers the selection process question with Alex's confirmed wording", async () => {
    const entries = await retrieveFor("Cual es el proceso de seleccion?");

    const entry = entries.find((candidate) => candidate.id === "faq-selection-process");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("Analizamos tu cuenta"))).toBe(true);
  });

  it("answers the target countries question with the Spanish-audience rationale", async () => {
    const entries = await retrieveFor("A que paises vendeis el contenido?");

    const entry = entries.find((candidate) => candidate.id === "faq-target-countries");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("poder adquisitivo"))).toBe(true);
    expect(entry?.prohibitedClaims.some((claim) => claim.includes("solo trabajamos con espanolas"))).toBe(true);
  });

  it("only returns ACTIVE entries approved by Alex for production retrieval of the promoted questions", async () => {
    for (const question of PROMOTED_BAIT_QUESTIONS) {
      const entries = await retrieveFor(question);
      expect(entries.length, question).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.status, `${question} -> ${entry.id}`).toBe("ACTIVE");
        expect(entry.approvedByAlex, `${question} -> ${entry.id}`).toBe(true);
      }
    }
  });

  // FIX 2: el modelo en vivo a veces etiqueta "Cual es el proceso de seleccion?" como
  // ASKS_ABOUT_CONTRACT. La intencion contractual NO debe forzar la entrada HIR
  // (contract-questions-human-review) cuando la pregunta es generica de proceso/seleccion: se
  // recupera faq-selection-process y se responde, no se escala.
  it("does not force the contract HIR entry when ASKS_ABOUT_CONTRACT is a generic process question", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: probeCandidate(),
      intent: "ASKS_ABOUT_CONTRACT",
      question: "Cual es el proceso de seleccion?",
      limit: 6
    });
    const ids = entries.map((entry) => entry.id);
    expect(ids).toContain("faq-selection-process");
    expect(ids).not.toContain("contract-questions-human-review");
  });

  it("STILL retrieves the contract HIR entry for a genuine contract question (permanence)", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: probeCandidate(),
      intent: "ASKS_ABOUT_CONTRACT",
      question: "El contrato tiene permanencia o clausula de exclusividad?",
      limit: 6
    });
    expect(entries.map((entry) => entry.id)).toContain("contract-questions-human-review");
  });

  // FIX 2 (cierre del hueco senalado por el revisor): una pregunta de baja/terminacion disfrazada de
  // "proceso" ('que pasos hay para salir?') sigue siendo contractual y debe mantener la escalada.
  it("STILL retrieves the contract HIR entry for a termination question disguised as a process question", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const entries = await retriever.retrieve({
      candidate: probeCandidate(),
      intent: "ASKS_ABOUT_CONTRACT",
      question: "Que pasos hay para salir si quiero dejarlo?",
      limit: 6
    });
    expect(entries.map((entry) => entry.id)).toContain("contract-questions-human-review");
  });

  it("never returns DRAFT entries for production retrieval even when they are the only match", async () => {
    const syntheticDraft = {
      ...businessKnowledgeEntries.find((entry) => entry.id === "faq-selection-process")!,
      id: "faq-synthetic-draft",
      status: "DRAFT" as const,
      approvedByAlex: false,
      requiresHumanReview: true
    };
    const retriever = new LocalBusinessKnowledgeRetriever([syntheticDraft]);

    const production = await retriever.retrieve({
      candidate: probeCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: "Cual es el proceso de seleccion?"
    });
    expect(production).toHaveLength(0);

    const withDrafts = await retriever.retrieve({
      candidate: probeCandidate(),
      intent: "REQUESTS_INFORMATION",
      question: "Cual es el proceso de seleccion?",
      includeDrafts: true
    });
    expect(withDrafts.map((entry) => entry.id)).toContain("faq-synthetic-draft");
  });

  // Iteracion 3, taxonomia 6: la CTA de llamada con cobertura ("si vemos que encaja", "2 a 10
  // minutos") es anti-canon. El Alex real agenda directo: "si me dices un dia y una hora lo agendamos".
  it("uses a direct scheduling CTA in the call entry, never the hedged corporate one", () => {
    const entry = businessKnowledgeEntries.find((candidate) => candidate.id === "call-details-after-review");
    expect(entry).toBeDefined();
    expect(entry?.approvedAnswerPoints.some((point) => point.toLowerCase().includes("si vemos que encaja"))).toBe(false);
    expect(entry?.approvedAnswerPoints.some((point) => point.includes("2 a 10 minutos"))).toBe(false);
    expect(entry?.approvedAnswerPoints.some((point) => point.toLowerCase().includes("whatsapp"))).toBe(true);
  });

  // Iteracion 3, taxonomia 4: la linea tecnica del neto y la tercera persona ("Alex calcula...")
  // salen de los puntos aprobados; la respuesta general canonica es "Solemos trabajar a porcentaje".
  it("keeps the general money answer canonical and the technical settlement details out of approved points", () => {
    const general = businessKnowledgeEntries.find((candidate) => candidate.id === "commercial-revenue-share-general");
    expect(general?.approvedAnswerPoints.some((point) => point.includes("Solemos trabajar a porcentaje"))).toBe(true);
    expect(general?.approvedAnswerPoints.some((point) => point.toLowerCase().includes("neto despues de la comision"))).toBe(
      false
    );
    // La cifra exacta sigue disponible SOLO como punto condicionado a la pregunta explicita.
    expect(general?.approvedAnswerPoints.some((point) => point.includes("70%") && point.includes("30%"))).toBe(true);

    const settlement = businessKnowledgeEntries.find((candidate) => candidate.id === "commercial-revenue-share-settlement");
    expect(settlement?.approvedAnswerPoints.some((point) => point.includes("Alex"))).toBe(false);
    expect(settlement?.approvedAnswerPoints.some((point) => point.toLowerCase().includes("skrill"))).toBe(false);
    expect(settlement?.approvedAnswerPoints.some((point) => point.includes("14 dias"))).toBe(true);
  });

  // Iteracion 3, taxonomia 2 (r11-t1/t2): "Podrian explicar solo x mensaje?" tiene rama documentada
  // (r12: "Claro! Te explico todo por aqui sin problema") y debe recuperar el pitch operativo.
  it("retrieves the services pitch when she asks to be told everything by message instead of a call", async () => {
    const byMessage = await retrieveFor("Podrian explicarme todo solo x mensaje?");
    expect(byMessage.map((entry) => entry.id)).toContain("services-agency-management");

    const noCalls = await retrieveFor("No quiero llamadas, me lo puedes explicar por aqui?");
    expect(noCalls.map((entry) => entry.id)).toContain("services-agency-management");
  });

  it("forbids repeating the real 75/25 anomaly and proactive salary offers in the commercial policy", () => {
    const revenueShare = businessKnowledgeEntries.find((entry) => entry.id === "commercial-revenue-share-general");
    expect(revenueShare?.prohibitedClaims.some((claim) => claim.includes("75% agencia / 25% para ti"))).toBe(true);
    expect(revenueShare?.prohibitedClaims.some((claim) => claim.toLowerCase().includes("salario fijo"))).toBe(true);

    const noFixedSalary = businessKnowledgeEntries.find((entry) => entry.id === "commercial-no-fixed-salary");
    expect(noFixedSalary?.prohibitedClaims.some((claim) => claim.toLowerCase().includes("proactivamente un salario fijo"))).toBe(
      true
    );
  });
});
