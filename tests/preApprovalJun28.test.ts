import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// PRE-OK (Alex 27/28-jun): "Encaja" es el UNICO OK general y vale ANTES o DESPUES de que la candidata acabe.
// - Pre-aprobada (Encaja en QUALIFYING) + movil OK: al terminar, el bot NO dice "lo comento con mi socio";
//   va directo a proponer la llamada (salto multi-hop seguro, sin tocar el grafo).
// - El movil DUDOSO sigue siendo decision APARTE: aunque este pre-aprobada, se queda esperando la decision del
//   movil de Alex. Menor -> cierra; negociacion/inyeccion -> revision (ganan ANTES del pre-OK).

function mk(mode: "AUTOMATIC" | "HUMAN_APPROVAL" = "AUTOMATIC") {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: mode
  });
  return { engine, repository };
}

// Candidata en QUALIFYING con TODA la info (lista para revision en cuanto llegue el siguiente mensaje).
async function seedReadyQualifying(repository: InMemoryCandidateRepository, overrides: Partial<Candidate> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: "pre_" + Math.random().toString().slice(2, 7), profileVisibility: "PUBLIC" }),
      firstName: "Ana",
      age: 30,
      isAdultConfirmed: true,
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      currentState: "QUALIFYING" as CandidateState,
      ...overrides
    } as Candidate)
  );
}

const HOLDING = /mi socio|lo comento|comentar tu perfil/i;

describe("Pre-OK: 'Encaja' antes de acabar -> el bot propone la llamada sin 'lo comento con mi socio'", () => {
  it("markProfileOk en QUALIFYING marca humanFitDecision=APPROVED (registra el pre-OK)", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository);
    const r = await engine.markProfileOk({ candidateId: c.id });
    expect(r.candidate.humanFitDecision).toBe("APPROVED");
    expect(r.candidate.currentState).toBe("QUALIFYING"); // no toca el estado todavia
    expect(r.proposedMessage).toBeNull();
  });

  it("pre-aprobada + movil OK: al terminar -> COLLECTING_CALL_DETAILS y propone la llamada (NO el holding)", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository);
    await engine.markProfileOk({ candidateId: c.id }); // PRE-OK
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, genial" }]
    });
    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect(r.response).not.toMatch(HOLDING);
    expect(r.response.toLowerCase()).toMatch(/dia|hora|whatsapp|llamada|movil/);
  });

  it("SIN pre-OK: al terminar frena en WAITING_HUMAN_REVIEW con el holding (comportamiento previo intacto)", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository);
    // Una inexperta que llega completa YA tuvo el pitch de la agencia en su turno de completar (Alex 15-jul):
    // se refleja en el historial para que el beat proactivo no lo repita aqui y salga el holding del socio.
    await repository.addMessage({
      id: "pitch-hist-preok",
      candidateId: c.id,
      role: "agent",
      author: "AI_AGENT",
      content: "Nosotros gestionamos cuentas de Instagram con ubicaciones y los chatters escriben por ti.",
      createdAt: new Date()
    });
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, genial" }]
    });
    expect(r.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(r.response).toMatch(HOLDING);
  });

  it("pre-aprobada pero MOVIL DUDOSO: NO avanza, se queda esperando la decision del movil de Alex", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository, { deviceEligibility: "PENDING_QUALITY_TEST", deviceModel: "iphone 11" });
    await engine.markProfileOk({ candidateId: c.id }); // PRE-OK
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "vale, genial" }]
    });
    expect(r.candidate.currentState).toBe("WAITING_HUMAN_REVIEW");
    expect(r.candidate.currentState).not.toBe("COLLECTING_CALL_DETAILS");
  });

  it("MENOR pre-aprobada por error: la edad gana -> CLOSED (invariante 2)", async () => {
    const { engine, repository } = mk();
    const c = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "premin_" + Math.random().toString().slice(2, 6), profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        currentState: "QUALIFYING" as CandidateState
      } as Candidate)
    );
    await engine.markProfileOk({ candidateId: c.id }); // pre-OK (sin edad aun)
    const r = await engine.handleIncomingTurn({ instagramUsername: c.instagramUsername, messages: [{ content: "tengo 16" }] });
    expect(r.candidate.currentState).toBe("CLOSED");
  });

  it("pre-aprobada que NEGOCIA -> revision humana (la escalada gana antes del pre-OK)", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository);
    await engine.markProfileOk({ candidateId: c.id }); // PRE-OK
    const r = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "quiero el 80% para mi o no entro" }]
    });
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("POST-OK: 'Encaja' en WAITING_HUMAN_REVIEW reanuda y propone la llamada (= Aprobar)", async () => {
    const { engine, repository } = mk();
    const c = await seedReadyQualifying(repository, { currentState: "WAITING_HUMAN_REVIEW" as CandidateState });
    const r = await engine.markProfileOk({ candidateId: c.id });
    expect(r.candidate.currentState).toBe("COLLECTING_CALL_DETAILS");
    expect((r.proposedMessage ?? "").length).toBeGreaterThan(0);
  });
});
