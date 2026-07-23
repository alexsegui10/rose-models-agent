import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { validateFactualResponse } from "@/application/factualValidator";
import { deviceEligibilityForDescription, deviceModelForDescription } from "@/application/policyRules";
import { businessKnowledgeEntries } from "@/content/business";
import { ResponsePlanSchema } from "@/domain/businessKnowledge";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// P0 de los chats REALES del 5-jul que Alex revisó a mano (esere.md): Yesica (propuesta de llamada sin
// su Encaja), Constanza (Telegram/Twitter/Drive), Brenda (pregunta de límites sin venir a cuento) y
// Marianel (Nubia re-preguntada dos veces).

function planBase(overrides: Record<string, unknown> = {}) {
  return ResponsePlanSchema.parse({
    objective: "responder con hechos aprobados",
    answerFacts: [],
    allowedClaims: [],
    prohibitedClaims: [],
    knowledgeEntryIds: [],
    questionToAsk: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    uncoveredQuestion: false,
    revenueSharePolicyVersion: null,
    ...overrides
  });
}

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

describe("re-sonda 6-jul: flecos del fallback cazados al reproducir los chats", () => {
  it("'Yesica es mi nombre' (nombre primero) capta el nombre", async () => {
    const { extractDeterministicUnderstanding } = await import("@/application/dataExtractor");
    const u = extractDeterministicUnderstanding("Yesica es mi nombre", { lastAgentMessage: "como te llamas?" });
    expect(u.extractedData.firstName).toBe("Yesica");
  });

  it("'Hola Alex' JAMÁS bautiza a la candidata como Alex (es el nombre del bot)", async () => {
    const { extractDeterministicUnderstanding } = await import("@/application/dataExtractor");
    const u = extractDeterministicUnderstanding("Hola Alex", { lastAgentMessage: "Para empezar, como te llamas?" });
    expect(u.extractedData.firstName).toBeUndefined();
    const u2 = extractDeterministicUnderstanding("me llamo alex", { lastAgentMessage: "como te llamas?" });
    expect(u2.extractedData.firstName).toBeUndefined();
  });

  it("pedir la llamada en cualificación SIN Encaja ya no promete 'agendamos una llamada'", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "mar32",
      profileVisibility: "PUBLIC",
      message: "Hola tengo 32 años"
    });
    await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "mar32",
      profileVisibility: "PUBLIC",
      message: "me llamo marianel"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "mar32",
      profileVisibility: "PUBLIC",
      message: "me pueden llamar y me lo explican?"
    });
    expect(result.response.toLowerCase()).not.toContain("agendamos una llamada y te lo explicamos");
  });
});

describe("YESICA: nadie propone agendar la llamada sin el Encaja de Alex (invariante 4)", () => {
  it("el validador tumba la propuesta de día/hora y el 'te la dejo apuntada' sin autorización", () => {
    for (const leaked of [
      "Que dia y hora te viene bien para la llamada?",
      "Si me dices el numero te la dejo apuntada",
      "Vale, mañana a las 13:30 me va bien la llamada",
      "Genial, la agendamos"
    ]) {
      const result = validateFactualResponse(leaked, planBase({ callSchedulingAuthorized: false }));
      expect(result.valid, `"${leaked}" debía bloquearse sin Encaja`).toBe(false);
    }
  });

  it("CON el Encaja de Alex la propuesta es legítima (no sobre-frenar el flujo aprobado)", () => {
    const result = validateFactualResponse(
      "Me gustaria que hicieramos una llamada rapida. Que dia y a que hora te viene mejor?",
      planBase({ callSchedulingAuthorized: true })
    );
    expect(result.valid).toBe(true);
  });

  it("sin falsos positivos: el opener y la línea honesta del socio pasan sin Encaja", () => {
    for (const ok of [
      "Te hago un par de preguntas rapidas mientras te explico como trabajamos, sin compromiso, y si encaja agendamos una llamada para contartelo con calma.",
      "En cuanto lo revise con mi socio te escribo y cuadramos la llamada, no te preocupes."
    ]) {
      const result = validateFactualResponse(ok, planBase({ callSchedulingAuthorized: false }));
      expect(result.valid, `"${ok.slice(0, 40)}..." no debía bloquearse`).toBe(true);
    }
  });

  it("el conocimiento de la llamada ya NO se sirve antes del Encaja (estados capados)", () => {
    const entry = businessKnowledgeEntries.find((candidate) => candidate.id === "call-details-after-review");
    expect(entry).toBeDefined();
    expect(entry!.allowedStates).not.toContain("NEW_LEAD");
    expect(entry!.allowedStates).not.toContain("QUALIFYING");
    expect(entry!.allowedStates).not.toContain("WAITING_HUMAN_REVIEW");
  });
});

describe("CONSTANZA: Telegram/Twitter/Drive/videollamadas/guiones eliminados del conocimiento", () => {
  it("la ficha services-secondary-traffic ya no existe", () => {
    expect(businessKnowledgeEntries.some((entry) => entry.id === "services-secondary-traffic")).toBe(false);
  });

  it("ninguna ficha ACTIVA de TEXTO menciona telegram/twitter/videollamadas/drive", () => {
    // Excepción (21-jul, 1ª llamada real): las fichas SOLO-LLAMADA (allowedStates = [CALL_IN_PROGRESS]) sí
    // pueden hablar del Drive — en la llamada el guion YA lo dice ("lo subes a una carpeta de Drive"). El
    // chat sigue protegido: el gateo por estado las excluye de todos los estados de texto (hay test aparte
    // en callContentDeliveryJul23 que verifica que en QUALIFYING no se recupera).
    const callOnly = (entry: (typeof businessKnowledgeEntries)[number]) =>
      entry.allowedStates.length === 1 && entry.allowedStates[0] === "CALL_IN_PROGRESS";
    const offenders = businessKnowledgeEntries.filter(
      (entry) =>
        entry.status === "ACTIVE" &&
        !callOnly(entry) &&
        [...entry.facts, ...entry.approvedAnswerPoints].some((line) => /telegram|twitter|videollamada|drive/i.test(line))
    );
    expect(offenders.map((entry) => entry.id)).toEqual([]);
  });

  it("E2E: '¿Solo lo hacen con Instagram?' jamás recibe Telegram/Twitter/Drive", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "constanza", profileVisibility: "PUBLIC" }),
        firstName: "Constanza",
        age: 37,
        isAdultConfirmed: true,
        currentState: "QUALIFYING"
      })
    );
    const result = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "Solo lo hacen con Instagram??"
    });
    expect(result.response.toLowerCase()).not.toMatch(/telegram|twitter|videollamada|drive|guiones/);
  });
});

describe("BRENDA: la pregunta de límites jamás salta en cualificación", () => {
  it("su mensaje real (only sin verificar + telegram) NO recibe la pregunta de límites y el guion sigue", async () => {
    const { engine } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "brenda",
      profileVisibility: "PUBLIC",
      message: "Hola buen día! Estoy interesada"
    });
    const result = await engine.handleIncomingMessage({
      candidateId: opener.candidate.id,
      instagramUsername: "brenda",
      profileVisibility: "PUBLIC",
      message:
        "Soy Melisa\nMe genere la página de only pero nunca la verifiqué tendría que empezar por ahí\nSolo estaba vendiendo contenido por telegram"
    });
    expect(result.response.toLowerCase()).not.toContain("limite");
    expect(result.response.toLowerCase()).not.toContain("contenido que no quieras hacer");
  });

  it("la ficha de límites ya no está permitida en QUALIFYING", () => {
    const entry = businessKnowledgeEntries.find((candidate) => candidate.id === "content-boundaries-neutral-question");
    expect(entry).toBeDefined();
    expect(entry!.allowedStates).not.toContain("QUALIFYING");
  });
});

describe("MARIANEL: Nubia y marcas de gama baja pausan a la primera (sin re-preguntar)", () => {
  it("'Nubiaa Focus 2 5g' -> NOT_ELIGIBLE con el modelo capturado en la ficha", () => {
    expect(deviceEligibilityForDescription("Nubiaa Focus 2 5g")).toBe("NOT_ELIGIBLE");
    expect(deviceModelForDescription("Nubiaa Focus 2 5g")).toContain("nubia");
    expect(deviceEligibilityForDescription("un tecno spark 10")).toBe("NOT_ELIGIBLE");
  });

  it("E2E: tras dar la Nubia, recibe el aviso del móvil UNA vez y no se le re-pregunta el modelo", async () => {
    const { engine, repository } = createEngine();
    const opener = await engine.handleIncomingMessage({
      instagramUsername: "mar",
      profileVisibility: "PUBLIC",
      message: "Hola tengo 32 años"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "mar",
      profileVisibility: "PUBLIC",
      message: "Hola si me llamo marianel"
    });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: "mar", profileVisibility: "PUBLIC", message: "32" });
    const dev = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "mar",
      profileVisibility: "PUBLIC",
      message: "Nubiaa Focus 2 5g"
    });
    expect(dev.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(dev.response.toLowerCase()).toContain("movil");
    expect(dev.response.toLowerCase()).not.toContain("exactamente");
    const followup = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: "mar",
      profileVisibility: "PUBLIC",
      message: "No es ni iphone ni samsung"
    });
    expect(followup.response.toLowerCase()).not.toContain("que modelo");
    const reloaded = await repository.findCandidateById(id);
    expect(reloaded?.deviceModel?.toLowerCase()).toContain("nubia");
  });
});
