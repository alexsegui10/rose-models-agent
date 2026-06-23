import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Bug de Alex 23-jun: una candidata YA APROBADA (Alex la acepto en el CRM -> COLLECTING_CALL_DETAILS, el bot
// dijo "nos encaja" y propuso la llamada) daba su numero y el bot volvia a decir "lo hablo con mi socio y te
// digo para agendarla" (eso es de antes de aprobar) y re-preguntaba el dia/hora. Ahora: con el numero ya dado,
// CONFIRMA la llamada ("te llamamos por WhatsApp lo antes posible") y pasa a READY_TO_SCHEDULE. Solo aplica a
// candidatas aprobadas: las que AUN esperan revision siguen derivando al socio (no se confunden).

function setup() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

describe("Cierre de llamada post-aprobacion (Alex 23-jun)", () => {
  it("APROBADA que da el numero -> CONFIRMA la llamada (no 'lo hablo con mi socio') y pasa a READY_TO_SCHEDULE", async () => {
    const { engine, repository } = setup();
    const c = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `call_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Alba",
        age: 38,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        deviceType: "IPHONE",
        deviceModel: "iphone 15",
        deviceEligibility: "APPROVED",
        humanFitDecision: "APPROVED",
        humanReviewStatus: "APPROVED",
        currentState: "COLLECTING_CALL_DETAILS" as CandidateState
      })
    );

    await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "Ahora dentro de 5min puede ser" }]
    });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "+34 600000000" }]
    });

    expect(r.candidate.currentState).toBe("READY_TO_SCHEDULE");
    expect(r.response.toLowerCase()).toMatch(/lo antes posible|te llamamos|te llamo/);
    expect(r.response.toLowerCase()).not.toContain("mi socio");

    // Insistir ("llamame ya") tampoco re-pregunta el dia/hora ni deriva al socio: reasegura la llamada.
    const r2 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "Llamame lo antes posible" }]
    });
    expect(r2.response.toLowerCase()).not.toContain("mi socio");
    expect(r2.response.toLowerCase()).not.toMatch(/que dia|que hora/);
  });

  it("NO-regresion: una candidata AUN en revision que da el numero SIGUE derivando al socio (no se confunde con la aprobada)", async () => {
    const { engine, repository } = setup();
    const c = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `rev_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Lara",
        age: 30,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        deviceEligibility: "APPROVED",
        deviceModel: "iphone 14",
        currentState: "WAITING_HUMAN_REVIEW" as CandidateState
      })
    );

    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "te paso mi numero +34 600111222" }]
    });

    // No esta aprobada: NO se confirma la llamada ni se avanza a agendado.
    expect(r.candidate.currentState).not.toBe("READY_TO_SCHEDULE");
    expect(r.response.toLowerCase()).not.toMatch(/te llamamos por whatsapp lo antes posible/);
  });

  async function seedApprovedCollecting(repository: InMemoryCandidateRepository) {
    return repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: `cw_${Math.random()}`, profileVisibility: "PUBLIC" }),
        firstName: "Alba",
        age: 38,
        isAdultConfirmed: true,
        hasOnlyFans: false,
        deviceType: "IPHONE",
        deviceModel: "iphone 15",
        deviceEligibility: "APPROVED",
        humanFitDecision: "APPROVED",
        humanReviewStatus: "APPROVED",
        currentState: "COLLECTING_CALL_DETAILS" as CandidateState
      })
    );
  }

  it("hora exacta en un turno y el numero en otro: NO se pierde, se AGENDA (Alex 23-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedApprovedCollecting(repository);
    await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "manana a las 6 de la tarde" }]
    });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "+34 600000000" }]
    });
    expect(r.candidate.currentState).toBe("CALL_SCHEDULED");
    expect(r.candidate.scheduledCallSlot).toBeTruthy();
  });

  it("franja vaga: pide la hora EXACTA una vez; si la da, agenda (Alex 23-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedApprovedCollecting(repository);
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "manana por la tarde" }] });
    const rAsk = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "+34 600000000" }]
    });
    expect(rAsk.response.toLowerCase()).toMatch(/sobre que hora|hora te viene/);
    const rDone = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "a las 6" }] });
    expect(rDone.candidate.currentState).toBe("CALL_SCHEDULED");
  });

  it("franja vaga: si tras pedir la hora SIGUE con una franja, se ACEPTA y se la llama en esa franja (Alex 23-jun)", async () => {
    const { engine, repository } = setup();
    const c = await seedApprovedCollecting(repository);
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "manana por la tarde" }] });
    await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "+34 600000000" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "por la tarde cuando sea" }]
    });
    expect(r.candidate.currentState).toBe("READY_TO_SCHEDULE");
    expect(r.response.toLowerCase()).toMatch(/tarde/);
    expect(r.response.toLowerCase()).not.toContain("mi socio");
    // La franja queda ACEPTADA y se limpia: un mensaje posterior NO re-confirma la franja en bucle.
    expect(r.candidate.callTimePreference).toBeUndefined();
    const r2 = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale gracias" }]
    });
    expect(r2.response.toLowerCase()).not.toContain("por la tarde cuando sea");
  });
});
