import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { InMemoryImportedConversationRepository } from "@/application/conversationImport";
import { InMemoryEvaluationRepository } from "@/application/evaluationRunner";
import { InMemoryConversationFeedbackRepository } from "@/application/responseFeedback";
import type { NegotiationDecision } from "@/domain/businessKnowledge";
import { createCandidate, type Candidate, type ConversationMessage, type StateTransition } from "@/domain/candidate";
import type { ABEvaluationCase, ABModelRun, EvaluationSession, PlaybackTurn, ProviderCallTrace } from "@/domain/evaluation";
import type { ApprovedResponse, ConversationFeedback } from "@/domain/styleEvaluation";
import { createDbConnection } from "@/infrastructure/db/client";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { PostgresCandidateRepository } from "@/infrastructure/repositories/postgresCandidateRepository";
import { PostgresConversationFeedbackRepository } from "@/infrastructure/repositories/postgresConversationFeedbackRepository";
import { PostgresEvaluationRepository } from "@/infrastructure/repositories/postgresEvaluationRepository";
import { PostgresImportedConversationRepository } from "@/infrastructure/repositories/postgresImportedConversationRepository";
import type {
  CandidateRepository,
  ConversationFeedbackRepository,
  EvaluationRepository,
  ImportedConversationRepository
} from "@/infrastructure/repositories/types";

// EXCEPCIÓN ACORDADA a la regla "sin test.skip": la pasada Postgres de este contrato necesita un
// PostgreSQL real y solo corre cuando TEST_DATABASE_URL está definida (apuntando SIEMPRE a
// rose_models_test, nunca a rose_models: cada test TRUNCA las tablas). En máquinas sin Postgres la
// suite sigue en verde gracias a describe.runIf — es gating condicional documentado, no un skip
// permanente. La pasada InMemory corre SIEMPRE. Para ejecutar la pasada Postgres:
//   $env:TEST_DATABASE_URL = "postgres://postgres:<password>@localhost:5432/rose_models_test"
const testDbUrl = process.env.TEST_DATABASE_URL;

interface RepositorySet {
  candidateRepository: CandidateRepository;
  feedbackRepository: ConversationFeedbackRepository;
  evaluationRepository: EvaluationRepository;
  importedConversationRepository: ImportedConversationRepository;
}

// ---------------------------------------------------------------------------
// Builders de entidades de prueba
// ---------------------------------------------------------------------------

function buildCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const base = createCandidate({
    instagramUsername: `contract_${randomUUID().slice(0, 13)}`,
    profileVisibility: "PUBLIC"
  });
  return { ...base, ...overrides };
}

function buildMessage(candidateId: string, overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: randomUUID(),
    candidateId,
    role: "candidate",
    author: "CANDIDATE",
    content: "hola, quiero info de la agencia",
    createdAt: new Date(),
    ...overrides
  };
}

function buildTransition(candidateId: string, overrides: Partial<StateTransition> = {}): StateTransition {
  return {
    id: randomUUID(),
    candidateId,
    fromState: "NEW_LEAD",
    toState: "QUALIFYING",
    trigger: "CANDIDATE_MESSAGE",
    reason: "La candidata respondió con interés.",
    createdAt: new Date(),
    ...overrides
  };
}

function buildNegotiationDecision(candidateId: string, overrides: Partial<NegotiationDecision> = {}): NegotiationDecision {
  return {
    candidateId,
    requestedModelPercentage: 40,
    currentPolicyAgencyPercentage: 70,
    currentPolicyModelPercentage: 30,
    decision: "KEEP_STANDARD_TERMS",
    approvedAgencyPercentage: null,
    approvedModelPercentage: null,
    reason: "Política estándar vigente.",
    decidedBy: "Alex",
    decidedAt: new Date(),
    ...overrides
  };
}

function buildFeedback(candidateId: string, overrides: Partial<ConversationFeedback> = {}): ConversationFeedback {
  return {
    id: randomUUID(),
    candidateId,
    messageId: randomUUID(),
    status: "APPROVED",
    originalResponse: "vale, te explico cómo trabajamos",
    state: "QUALIFYING",
    contextSnapshot: "candidata interesada, sin datos de edad",
    createdAt: new Date(),
    styleProfileVersion: "test-style-1",
    promptVersion: "test-prompt-1",
    modelVersion: "deterministic-test",
    ...overrides
  };
}

function buildApprovedResponse(feedbackId: string, overrides: Partial<ApprovedResponse> = {}): ApprovedResponse {
  return {
    id: randomUUID(),
    feedbackId,
    response: "vale, te explico cómo trabajamos",
    state: "QUALIFYING",
    tags: ["saludo"],
    approvedAt: new Date(),
    styleProfileVersion: "test-style-1",
    promptVersion: "test-prompt-1",
    modelVersion: "deterministic-test",
    ...overrides
  };
}

function buildProviderTrace(overrides: Partial<ProviderCallTrace> = {}): ProviderCallTrace {
  return {
    requestedProvider: "DETERMINISTIC",
    actualProvider: "DETERMINISTIC",
    requestedModel: "deterministic-local",
    actualModel: "deterministic-local",
    usedFallback: false,
    fallbackReason: null,
    durationMs: 12,
    retryCount: 0,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    ...overrides
  };
}

function buildAbRun(label: "A" | "B", model: string): ABModelRun {
  return {
    label,
    model,
    response: `respuesta del modelo ${label}`,
    stateAfter: "QUALIFYING",
    providerTrace: buildProviderTrace({ requestedModel: model, actualModel: model }),
    knowledgeEntryIds: ["commercial-policy-v1"],
    retrievedExampleIds: ["example-1"],
    factualValid: true,
    styleScore: 0.85
  };
}

function buildAbCase(overrides: Partial<ABEvaluationCase> = {}): ABEvaluationCase {
  return {
    id: randomUUID(),
    createdAt: new Date(),
    blind: true,
    initialState: "NEW_LEAD",
    profileVisibility: "PUBLIC",
    messages: ["hola, quiero info"],
    modelA: "model-a-test",
    modelB: "model-b-test",
    runA: buildAbRun("A", "model-a-test"),
    runB: buildAbRun("B", "model-b-test"),
    ...overrides
  };
}

function buildPlaybackTurn(turnIndex: number): PlaybackTurn {
  return {
    turnIndex,
    candidateMessage: "hola, me interesa la agencia",
    generatedResponse: "vale, te cuento cómo va",
    originalResponse: "respuesta original de alex",
    resultingState: "QUALIFYING",
    suggestedIssues: ["TOO_LONG"],
    providerTrace: buildProviderTrace()
  };
}

function buildSession(conversationId: string, overrides: Partial<EvaluationSession> = {}): EvaluationSession {
  return {
    id: randomUUID(),
    conversationId,
    model: "deterministic-local",
    createdAt: new Date(),
    turnFeedback: [
      {
        turnIndex: 0,
        status: "APPROVED",
        originalResponse: "vale, te cuento cómo va",
        issues: []
      }
    ],
    playbackTurns: [buildPlaybackTurn(0)],
    summary: {
      approvedWithoutChangesPct: 100,
      editedPct: 0,
      rejectedPct: 0,
      averageStyleRating: 4,
      factualErrors: 0,
      stateFailures: 0,
      repetitions: 0,
      model: "deterministic-local",
      estimatedCostUsd: 0,
      averageLatencyMs: 12
    },
    ...overrides
  };
}

// Sin teléfonos, emails ni handles: el import rechaza PII (parseAnonymizedConversationJson).
function buildImportedConversationsJson(ids: string[]): string {
  return JSON.stringify({
    version: "1",
    conversations: ids.map((id) => ({
      id,
      status: "RAW_REAL",
      source: "ANONYMIZED_JSON",
      purpose: "EVALUATION",
      category: "contract-test",
      initialState: "NEW_LEAD",
      stateBefore: "NEW_LEAD",
      messages: [
        { role: "candidate", content: "hola, vi vuestra agencia y quiero saber más" },
        { role: "alex", content: "vale, te explico cómo trabajamos" }
      ],
      notes: "conversación de prueba del contrato"
    }))
  });
}

// ---------------------------------------------------------------------------
// Contrato compartido: las MISMAS aserciones corren contra InMemory y Postgres
// ---------------------------------------------------------------------------

function runRepositoryContract(getRepos: () => RepositorySet) {
  describe("candidatas", () => {
    it("saveCandidate + findCandidateById hace roundtrip con fechas revividas como Date", async () => {
      const { candidateRepository } = getRepos();
      const lastMessageAt = new Date(Date.now() - 60_000);
      const candidate = buildCandidate({
        age: 22,
        isAdultConfirmed: true,
        country: "España",
        city: "Valencia",
        deviceType: "IPHONE",
        deviceModel: "iPhone 15",
        currentMonthlyRevenue: 1500.5,
        objections: ["no quiero enseñar la cara"],
        notes: ["pidió detalles del reparto"],
        onboardingBlockers: ["CONTRACT_REQUIRED"],
        interestLevel: "HIGH",
        lastMessageAt
      });

      await candidateRepository.saveCandidate(candidate);
      const found = await candidateRepository.findCandidateById(candidate.id);

      expect(found).not.toBeNull();
      expect(found?.instagramUsername).toBe(candidate.instagramUsername);
      expect(found?.age).toBe(22);
      expect(found?.isAdultConfirmed).toBe(true);
      expect(found?.deviceType).toBe("IPHONE");
      expect(found?.deviceModel).toBe("iPhone 15");
      expect(found?.currentMonthlyRevenue).toBe(1500.5);
      expect(found?.objections).toEqual(["no quiero enseñar la cara"]);
      expect(found?.onboardingBlockers).toEqual(["CONTRACT_REQUIRED"]);
      expect(found?.interestLevel).toBe("HIGH");
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.updatedAt).toBeInstanceOf(Date);
      expect(found?.lastMessageAt).toBeInstanceOf(Date);
      expect(found?.createdAt.getTime()).toBe(candidate.createdAt.getTime());
      expect(found?.lastMessageAt?.getTime()).toBe(lastMessageAt.getTime());
    });

    it("findCandidateById devuelve null para un id desconocido o con formato no-uuid", async () => {
      const { candidateRepository } = getRepos();
      expect(await candidateRepository.findCandidateById(randomUUID())).toBeNull();
      expect(await candidateRepository.findCandidateById("no-es-un-uuid")).toBeNull();
    });

    it("findCandidateByInstagram no distingue mayúsculas/minúsculas", async () => {
      const { candidateRepository } = getRepos();
      const suffix = randomUUID().slice(0, 8);
      const candidate = buildCandidate({ instagramUsername: `Contract_MixedCase_${suffix}` });

      await candidateRepository.saveCandidate(candidate);
      const found = await candidateRepository.findCandidateByInstagram(`contract_mixedcase_${suffix}`);

      expect(found?.id).toBe(candidate.id);
      expect(await candidateRepository.findCandidateByInstagram(`contract_missing_${suffix}`)).toBeNull();
    });

    it("aplica la semántica de normalizeCandidate al leer (opcionales undefined, defaults presentes)", async () => {
      const { candidateRepository } = getRepos();
      const candidate = buildCandidate();

      await candidateRepository.saveCandidate(candidate);
      const found = await candidateRepository.findCandidateById(candidate.id);

      expect(found?.age).toBeUndefined();
      expect(found?.country).toBeUndefined();
      expect(found?.humanReviewReason).toBeUndefined();
      expect(found?.lastMessageAt).toBeUndefined();
      expect(found?.deviceModel).toBeNull();
      expect(found?.deviceEligibility).toBe("UNKNOWN");
      expect(found?.commercialTier).toBe("STANDARD");
      expect(found?.humanFitDecision).toBe("PENDING");
      expect(found?.onboardingBlockers).toEqual([]);
      expect(found?.objections).toEqual([]);
      expect(found?.conversationSummary).toBe("");
      expect(found?.generationCancellationVersion).toBe(0);
    });

    it("saveCandidate actualiza (upsert) y listCandidates ordena por updatedAt descendente", async () => {
      const { candidateRepository } = getRepos();
      const oldest = buildCandidate({ updatedAt: new Date(Date.now() - 30_000) });
      const newest = buildCandidate({ updatedAt: new Date(Date.now() - 1_000) });
      const middle = buildCandidate({ updatedAt: new Date(Date.now() - 15_000) });

      await candidateRepository.saveCandidate(oldest);
      await candidateRepository.saveCandidate(newest);
      await candidateRepository.saveCandidate(middle);
      await candidateRepository.saveCandidate({ ...middle, city: "Madrid" });

      const listed = await candidateRepository.listCandidates();
      expect(listed.map((item) => item.id)).toEqual([newest.id, middle.id, oldest.id]);
      expect(listed[1]?.city).toBe("Madrid");
      expect(listed).toHaveLength(3);
    });
  });

  describe("mensajes", () => {
    it("addMessage + listMessages devuelve los mensajes en orden cronológico respetando el límite", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const base = Date.now() - 10_000;

      await candidateRepository.addMessage(buildMessage(candidate.id, { content: "uno", createdAt: new Date(base) }));
      await candidateRepository.addMessage(buildMessage(candidate.id, { content: "dos", createdAt: new Date(base + 1_000) }));
      await candidateRepository.addMessage(buildMessage(candidate.id, { content: "tres", createdAt: new Date(base + 2_000) }));

      const all = await candidateRepository.listMessages(candidate.id);
      expect(all.map((message) => message.content)).toEqual(["uno", "dos", "tres"]);

      const lastTwo = await candidateRepository.listMessages(candidate.id, 2);
      expect(lastTwo.map((message) => message.content)).toEqual(["dos", "tres"]);
    });

    it("deduplica de forma idempotente por (candidateId, externalMessageId)", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());

      await candidateRepository.addMessage(
        buildMessage(candidate.id, { content: "primero", externalMessageId: "ig-contract-1" })
      );
      await candidateRepository.addMessage(
        buildMessage(candidate.id, { content: "duplicado distinto", externalMessageId: "ig-contract-1" })
      );

      const messages = await candidateRepository.listMessages(candidate.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("primero");

      const byExternalId = await candidateRepository.findMessageByExternalId(candidate.id, "ig-contract-1");
      expect(byExternalId?.content).toBe("primero");
      expect(await candidateRepository.findMessageByExternalId(candidate.id, "ig-desconocido")).toBeNull();
    });

    it("los mensajes sin externalMessageId no chocan entre sí y conservan metadata", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const base = Date.now() - 5_000;

      await candidateRepository.addMessage(
        buildMessage(candidate.id, {
          role: "agent",
          author: "AI_AGENT",
          content: "respuesta uno",
          createdAt: new Date(base),
          metadata: { inboundExternalMessageIds: "ig-a", usedFallback: false, retryCount: 0 }
        })
      );
      await candidateRepository.addMessage(
        buildMessage(candidate.id, {
          role: "agent",
          author: "AI_AGENT",
          content: "respuesta dos",
          createdAt: new Date(base + 500)
        })
      );

      const messages = await candidateRepository.listMessages(candidate.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]?.metadata).toEqual({ inboundExternalMessageIds: "ig-a", usedFallback: false, retryCount: 0 });
      expect(messages[1]?.metadata).toBeUndefined();
      expect(messages[0]?.externalMessageId).toBeUndefined();
    });
  });

  describe("transiciones", () => {
    it("addTransition añade y listTransitions devuelve las transiciones de la candidata", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const other = await candidateRepository.saveCandidate(buildCandidate());
      const base = Date.now() - 5_000;

      await candidateRepository.addTransition(buildTransition(candidate.id, { createdAt: new Date(base) }));
      await candidateRepository.addTransition(
        buildTransition(candidate.id, {
          fromState: "QUALIFYING",
          toState: "WAITING_HUMAN_REVIEW",
          trigger: "QUALIFICATION_COMPLETE",
          reason: "Datos completos.",
          createdAt: new Date(base + 1_000)
        })
      );
      await candidateRepository.addTransition(buildTransition(other.id, { createdAt: new Date(base + 2_000) }));

      const transitions = await candidateRepository.listTransitions(candidate.id);
      expect(transitions).toHaveLength(2);
      expect(transitions.map((transition) => transition.toState)).toEqual(["QUALIFYING", "WAITING_HUMAN_REVIEW"]);
      expect(transitions[0]?.createdAt).toBeInstanceOf(Date);
    });

    it("no duplica una transición idéntica (mismo from/to/trigger/reason)", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const transition = buildTransition(candidate.id);

      await candidateRepository.addTransition(transition);
      await candidateRepository.addTransition({ ...transition, id: randomUUID(), createdAt: new Date() });

      expect(await candidateRepository.listTransitions(candidate.id)).toHaveLength(1);
    });
  });

  describe("decisiones de negociación", () => {
    it("solo devuelve la decisión cuando es ALLOW_CUSTOM_TERMS", async () => {
      const { candidateRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());

      await candidateRepository.saveNegotiationDecision(buildNegotiationDecision(candidate.id));
      expect(await candidateRepository.findApprovedNegotiationDecision(candidate.id)).toBeNull();

      const approved = buildNegotiationDecision(candidate.id, {
        decision: "ALLOW_CUSTOM_TERMS",
        approvedAgencyPercentage: 60,
        approvedModelPercentage: 40,
        reason: "Excepción aprobada por Alex."
      });
      await candidateRepository.saveNegotiationDecision(approved);

      const found = await candidateRepository.findApprovedNegotiationDecision(candidate.id);
      expect(found?.decision).toBe("ALLOW_CUSTOM_TERMS");
      expect(found?.approvedAgencyPercentage).toBe(60);
      expect(found?.approvedModelPercentage).toBe(40);
      expect(found?.decidedAt).toBeInstanceOf(Date);
      expect(await candidateRepository.findApprovedNegotiationDecision(randomUUID())).toBeNull();
    });
  });

  describe("feedback y respuestas aprobadas", () => {
    it("guarda feedback (con styleRating) y lo lista filtrando por candidata", async () => {
      const { candidateRepository, feedbackRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const other = await candidateRepository.saveCandidate(buildCandidate());

      const feedback = buildFeedback(candidate.id, { styleRating: 4, editedResponse: "vale, te lo cuento", status: "EDITED" });
      await feedbackRepository.saveFeedback(feedback);
      await feedbackRepository.saveFeedback(buildFeedback(other.id));

      const forCandidate = await feedbackRepository.listFeedback(candidate.id);
      expect(forCandidate).toHaveLength(1);
      expect(forCandidate[0]?.id).toBe(feedback.id);
      expect(forCandidate[0]?.styleRating).toBe(4);
      expect(forCandidate[0]?.editedResponse).toBe("vale, te lo cuento");
      expect(forCandidate[0]?.createdAt).toBeInstanceOf(Date);

      const all = await feedbackRepository.listFeedback();
      expect(all).toHaveLength(2);

      const withoutRating = all.find((item) => item.candidateId === other.id);
      expect(withoutRating?.styleRating).toBeUndefined();
      expect(withoutRating?.editedResponse).toBeUndefined();
    });

    it("guarda y lista respuestas aprobadas ligadas a su feedback", async () => {
      const { candidateRepository, feedbackRepository } = getRepos();
      const candidate = await candidateRepository.saveCandidate(buildCandidate());
      const feedback = await feedbackRepository.saveFeedback(buildFeedback(candidate.id));

      const approved = buildApprovedResponse(feedback.id);
      await feedbackRepository.saveApprovedResponse(approved);

      const listed = await feedbackRepository.listApprovedResponses();
      expect(listed).toHaveLength(1);
      expect(listed[0]?.feedbackId).toBe(feedback.id);
      expect(listed[0]?.tags).toEqual(["saludo"]);
      expect(listed[0]?.approvedAt).toBeInstanceOf(Date);
    });
  });

  describe("casos A/B", () => {
    it("saveABCase + listABCases hace roundtrip de los runs jsonb y ordena por createdAt descendente", async () => {
      const { evaluationRepository } = getRepos();
      const older = buildAbCase({ createdAt: new Date(Date.now() - 20_000) });
      const newer = buildAbCase({ createdAt: new Date(Date.now() - 1_000) });

      await evaluationRepository.saveABCase(older);
      await evaluationRepository.saveABCase(newer);

      const listed = await evaluationRepository.listABCases();
      expect(listed.map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(listed[1]?.runA).toEqual(older.runA);
      expect(listed[1]?.runB.providerTrace.actualModel).toBe("model-b-test");
      expect(listed[1]?.createdAt).toBeInstanceOf(Date);
      expect(listed[1]?.winner).toBeUndefined();
    });

    it("recordABDecision registra ganador, rating y nota", async () => {
      const { evaluationRepository } = getRepos();
      const abCase = buildAbCase();
      await evaluationRepository.saveABCase(abCase);

      const updated = await evaluationRepository.recordABDecision({
        id: abCase.id,
        winner: "A",
        styleRating: 5,
        note: "la A suena más a Alex"
      });

      expect(updated.winner).toBe("A");
      expect(updated.styleRating).toBe(5);
      expect(updated.note).toBe("la A suena más a Alex");

      const listed = await evaluationRepository.listABCases();
      expect(listed[0]?.winner).toBe("A");
    });

    it("recordABDecision lanza error si el caso no existe", async () => {
      const { evaluationRepository } = getRepos();
      await expect(evaluationRepository.recordABDecision({ id: randomUUID(), winner: "TIE" })).rejects.toThrow(
        "AB evaluation not found."
      );
    });
  });

  describe("sesiones de evaluación", () => {
    it("saveSession + getSession conserva playbackTurns, turnFeedback y summary", async () => {
      const { evaluationRepository, importedConversationRepository } = getRepos();
      const conversationId = `contract-conv-${randomUUID().slice(0, 8)}`;
      await importedConversationRepository.importJson(buildImportedConversationsJson([conversationId]));

      const session = buildSession(conversationId);
      await evaluationRepository.saveSession(session);

      const found = await evaluationRepository.getSession(session.id);
      expect(found).not.toBeNull();
      expect(found?.conversationId).toBe(conversationId);
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.playbackTurns).toEqual(session.playbackTurns);
      expect(found?.turnFeedback).toEqual(session.turnFeedback);
      expect(found?.summary).toEqual(session.summary);
      expect(await evaluationRepository.getSession(randomUUID())).toBeNull();
    });

    it("saveSession actualiza (upsert) y listSessions ordena por createdAt descendente", async () => {
      const { evaluationRepository, importedConversationRepository } = getRepos();
      const conversationId = `contract-conv-${randomUUID().slice(0, 8)}`;
      await importedConversationRepository.importJson(buildImportedConversationsJson([conversationId]));

      const older = buildSession(conversationId, { createdAt: new Date(Date.now() - 20_000) });
      const newer = buildSession(conversationId, { createdAt: new Date(Date.now() - 1_000) });
      await evaluationRepository.saveSession(older);
      await evaluationRepository.saveSession(newer);
      await evaluationRepository.saveSession({ ...older, model: "modelo-editado" });

      const listed = await evaluationRepository.listSessions();
      expect(listed.map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(listed[1]?.model).toBe("modelo-editado");
    });
  });

  describe("conversaciones importadas", () => {
    it("importJson persiste, list ordena por id y get devuelve la conversación completa", async () => {
      const { importedConversationRepository } = getRepos();
      const suffix = randomUUID().slice(0, 8);
      const idB = `contract-import-b-${suffix}`;
      const idA = `contract-import-a-${suffix}`;

      const imported = await importedConversationRepository.importJson(buildImportedConversationsJson([idB, idA]));
      expect(imported.map((conversation) => conversation.id)).toEqual([idB, idA]);

      const listed = await importedConversationRepository.list();
      expect(listed.map((conversation) => conversation.id)).toEqual([idA, idB]);

      const found = await importedConversationRepository.get(idA);
      expect(found?.status).toBe("RAW_REAL");
      expect(found?.purpose).toBe("EVALUATION");
      expect(found?.messages).toHaveLength(2);
      expect(found?.messages[0]?.role).toBe("candidate");
      expect(found?.messages[0]?.approved).toBe(false);
      expect(found?.notes).toBe("conversación de prueba del contrato");
      expect(found?.idealNextResponse).toBeUndefined();
      expect(found?.tags).toEqual([]);
      expect(await importedConversationRepository.get(`contract-missing-${suffix}`)).toBeNull();
    });

    it("importJson es idempotente por id (re-importar sobrescribe, no duplica)", async () => {
      const { importedConversationRepository } = getRepos();
      const id = `contract-import-${randomUUID().slice(0, 8)}`;

      await importedConversationRepository.importJson(buildImportedConversationsJson([id]));
      await importedConversationRepository.importJson(buildImportedConversationsJson([id]));

      const listed = await importedConversationRepository.list();
      expect(listed.filter((conversation) => conversation.id === id)).toHaveLength(1);
    });

    it("importJson rechaza conversaciones con datos personales", async () => {
      const { importedConversationRepository } = getRepos();
      const json = JSON.stringify({
        version: "1",
        conversations: [
          {
            id: "contract-pii",
            status: "RAW_REAL",
            source: "ANONYMIZED_JSON",
            purpose: "EVALUATION",
            messages: [{ role: "candidate", content: "mi número es 612345678" }]
          }
        ]
      });

      await expect(importedConversationRepository.importJson(json)).rejects.toThrow(/personal data/);
      expect(await importedConversationRepository.get("contract-pii")).toBeNull();
    });
  });
}

// ---------------------------------------------------------------------------
// Pasada 1: implementaciones InMemory (corren SIEMPRE)
// ---------------------------------------------------------------------------

describe("contrato de repositorios — InMemory", () => {
  let repos: RepositorySet;

  beforeEach(() => {
    repos = {
      candidateRepository: new InMemoryCandidateRepository(),
      feedbackRepository: new InMemoryConversationFeedbackRepository(),
      evaluationRepository: new InMemoryEvaluationRepository(),
      importedConversationRepository: new InMemoryImportedConversationRepository()
    };
  });

  runRepositoryContract(() => repos);
});

// ---------------------------------------------------------------------------
// Pasada 2: implementaciones Postgres (gated por TEST_DATABASE_URL, ver nota arriba)
// ---------------------------------------------------------------------------

describe.runIf(Boolean(testDbUrl))("contrato de repositorios — Postgres (rose_models_test)", () => {
  // createDbConnection es perezosa: construirla aquí no abre sockets si la pasada está gated.
  const connection = createDbConnection(testDbUrl ?? "", { max: 1 });
  let repos: RepositorySet;

  beforeAll(async () => {
    // Vitest ejecuta los ficheros de test en paralelo y este suite TRUNCA tablas: el advisory
    // lock serializa los suites que tocan rose_models_test (mismo lock en postgresSchema.test.ts).
    // Se libera solo al cerrar la conexión (max: 1 ⇒ el lock vive en esta sesión).
    await connection.client.unsafe("select pg_advisory_lock(727274)");
  });

  beforeEach(async () => {
    // Cada test parte de tablas limpias. SOLO contra rose_models_test (TEST_DATABASE_URL).
    await connection.client.unsafe(
      `TRUNCATE TABLE candidates, conversation_messages, state_transitions, negotiation_decisions,
       conversation_feedback, approved_responses, ab_evaluation_cases, evaluation_sessions,
       imported_conversations CASCADE`
    );
    repos = {
      candidateRepository: new PostgresCandidateRepository(connection.db),
      feedbackRepository: new PostgresConversationFeedbackRepository(connection.db),
      evaluationRepository: new PostgresEvaluationRepository(connection.db),
      importedConversationRepository: new PostgresImportedConversationRepository(connection.db)
    };
  });

  afterAll(async () => {
    await connection.client.unsafe("select pg_advisory_unlock(727274)");
    await connection.client.end();
  });

  runRepositoryContract(() => repos);
});
