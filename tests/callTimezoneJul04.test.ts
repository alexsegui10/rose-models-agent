import { describe, expect, it } from "vitest";
import {
  argentinaLabelFromMs,
  candidateLabelFromMs,
  candidateZoneFromPhone,
  parseProposedCallTime
} from "@/application/callScheduling";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// LANZAMIENTO 3-jul: el agendado interpretaba SIEMPRE la hora como Argentina (UTC-3). A una candidata
// ESPAÑOLA (+34) que decía "a las 18" se le agendaba a las 18:00 argentinas = 23:00 de España: la
// llamada salía 5 horas tarde. La zona se decide por el PREFIJO del teléfono (+34 -> España con su
// horario de verano; +54 y todo lo demás -> Argentina, el país del anuncio).

describe("candidateZoneFromPhone: zona por prefijo", () => {
  it("+34 (con espacios, con 0034) -> ES", () => {
    expect(candidateZoneFromPhone("+34 612 34 56 78")).toBe("ES");
    expect(candidateZoneFromPhone("0034612345678")).toBe("ES");
    expect(candidateZoneFromPhone("34612345678")).toBe("ES");
  });
  it("+54, números sin prefijo y vacío -> AR (el país de las candidatas)", () => {
    expect(candidateZoneFromPhone("+54 9 11 5352 8311")).toBe("AR");
    expect(candidateZoneFromPhone("612345678")).toBe("AR");
    expect(candidateZoneFromPhone(undefined)).toBe("AR");
    expect(candidateZoneFromPhone("")).toBe("AR");
  });
});

describe("parseProposedCallTime con zona ES: la hora es la de ESPAÑA (con su DST)", () => {
  const nowSummer = new Date(Date.UTC(2026, 6, 4, 10, 0)); // 4-jul-2026 (sábado), CEST = UTC+2

  it("verano: 'mañana a las 18' ES -> 16:00 UTC; la lectura AR habría sido 21:00 UTC (5h de error)", () => {
    const es = parseProposedCallTime("mañana a las 18", nowSummer, "ES");
    expect(es).not.toBeNull();
    expect(es!.startMsUtc).toBe(Date.UTC(2026, 6, 5, 16, 0));
    const ar = parseProposedCallTime("mañana a las 18", nowSummer, "AR");
    expect(ar!.startMsUtc).toBe(Date.UTC(2026, 6, 5, 21, 0));
  });

  it("invierno: 'mañana a las 18' ES -> 17:00 UTC (CET = UTC+1)", () => {
    const winter = new Date(Date.UTC(2026, 0, 15, 10, 0)); // 15-ene (jueves)
    const es = parseProposedCallTime("mañana a las 18", winter, "ES");
    expect(es!.startMsUtc).toBe(Date.UTC(2026, 0, 16, 17, 0));
  });

  it("'hoy' se resuelve en el CALENDARIO de la candidata: a las 23:30 UTC en Madrid ya es el día siguiente", () => {
    const lateUtc = new Date(Date.UTC(2026, 6, 4, 23, 30)); // Madrid: 5-jul 01:30
    const es = parseProposedCallTime("hoy a las 8 de la noche", lateUtc, "ES");
    expect(es).not.toBeNull();
    expect(es!.startMsUtc).toBe(Date.UTC(2026, 6, 5, 18, 0)); // 5-jul 20:00 CEST
  });

  it("labels: para ES labelEs y labelCandidate coinciden (18:00); para AR difieren (23:00 vs 18:00)", () => {
    const es = parseProposedCallTime("mañana a las 18", nowSummer, "ES")!;
    expect(es.labelEs).toContain("18:00");
    expect(es.labelCandidate).toContain("18:00");
    const ar = parseProposedCallTime("mañana a las 6 de la tarde", nowSummer, "AR")!;
    expect(ar.labelEs).toContain("23:00");
    expect(ar.labelCandidate).toContain("18:00");
    expect(ar.labelCandidate).toBe(ar.labelAr);
  });

  it("candidateLabelFromMs: el mismo instante, cada una en su reloj", () => {
    const ms = Date.UTC(2026, 6, 6, 16, 0); // lunes 6-jul 16:00 UTC
    expect(candidateLabelFromMs(ms, "ES")).toBe("el lunes a las 18:00");
    expect(candidateLabelFromMs(ms, "AR")).toBe("el lunes a las 13:00");
    expect(candidateLabelFromMs(ms, "AR")).toBe(argentinaLabelFromMs(ms));
  });
});

describe("motor: la candidata +34 agenda en hora de ESPAÑA; la argentina, como siempre", () => {
  function createEngine() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever()
    });
    return { engine, repository };
  }

  async function seed(repository: InMemoryCandidateRepository, phone: string, state: CandidateState = "COLLECTING_CALL_DETAILS") {
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `tz_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 24,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        deviceType: "IPHONE",
        deviceModel: "iphone 13",
        deviceEligibility: "APPROVED",
        humanFitDecision: "APPROVED",
        humanProfileReviewStatus: "POTENTIAL_FIT",
        phone,
        currentState: state,
        automationPaused: false,
        manualControlActive: false
      })
    );
  }

  it("+34: 'manana a las 18' -> el instante agendado es el de las 18:00 de Madrid y se le confirma SU hora", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "+34 612 345 678");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18"
    });
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
    const expected = parseProposedCallTime("manana a las 18", new Date(), "ES")!.startMsUtc;
    expect(reply.candidate.scheduledCallStartMs).toBe(expected);
    expect(reply.response).toContain("18:00");
  });

  it("+54: 'manana a las 18' sigue siendo hora ARGENTINA (regresión: nada cambia para el caso normal)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await seed(repository, "+54 9 11 5352 8311");
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "manana a las 18"
    });
    expect(reply.candidate.currentState).toBe("CALL_SCHEDULED");
    const expected = parseProposedCallTime("manana a las 18", new Date(), "AR")!.startMsUtc;
    expect(reply.candidate.scheduledCallStartMs).toBe(expected);
    expect(reply.response).toContain("18:00");
  });
});
