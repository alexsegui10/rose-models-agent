import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ImportedConversationSchema, type ImportedConversation } from "@/application/conversationImport";
import {
  addTurnFeedback,
  createEvaluationSession,
  InMemoryEvaluationRepository,
  playImportedConversation,
  suggestEvaluationIssues
} from "@/application/evaluationRunner";
import { CandidateStateSchema } from "@/domain/candidate";
import { EvaluationSessionSchema, type PlaybackTurn } from "@/domain/evaluation";
import type { StyleEvaluation } from "@/domain/styleEvaluation";
import { loadSnapshot, saveSnapshotAtomic } from "@/infrastructure/persistence/jsonSnapshotStore";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rose-playback-"));
  tempDirs.push(dir);
  return dir;
}

function buildConversation(messages: unknown[], overrides: Record<string, unknown> = {}): ImportedConversation {
  return ImportedConversationSchema.parse({
    id: "playback-1",
    status: "CORRECTED",
    source: "ANONYMIZED_JSON",
    purpose: "EVALUATION",
    category: "qualification",
    messages,
    ...overrides
  });
}

function cleanStyleEvaluation(overrides: Partial<StyleEvaluation> = {}): StyleEvaluation {
  return {
    isSpanishFromSpain: true,
    soundsNatural: true,
    soundsLikeAlex: true,
    isTooFormal: false,
    isTooLong: false,
    soundsRobotic: false,
    repeatsKnownInformation: false,
    asksTooManyQuestions: false,
    usesForbiddenExpression: false,
    addressesCandidateMessage: true,
    score: 1,
    reasons: [],
    ...overrides
  };
}

function buildPlaybackTurn(turnIndex: number, overrides: Partial<PlaybackTurn> = {}): PlaybackTurn {
  return {
    turnIndex,
    candidateMessage: `Mensaje ${turnIndex}`,
    generatedResponse: `Respuesta generada ${turnIndex}`,
    originalResponse: `Respuesta original ${turnIndex}`,
    resultingState: "QUALIFYING",
    suggestedIssues: [],
    providerTrace: {
      requestedProvider: "deterministic",
      actualProvider: "deterministic",
      requestedModel: "gpt-5.4-mini",
      actualModel: "gpt-5.4-mini",
      usedFallback: false,
      fallbackReason: null,
      durationMs: 100,
      retryCount: 0,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: 0.01
    },
    ...overrides
  };
}

describe("IMPORTED_CONVERSATION_PLAYBACK", () => {
  it("replays candidate messages in order and pairs each turn with the original response", async () => {
    const conversation = buildConversation([
      { role: "candidate", content: "Hola, quiero informacion" },
      { role: "alex", content: "Hola, cuentame un poco de ti" },
      { role: "candidate", content: "Tengo 23 anos y soy de Madrid" },
      { role: "alex", content: "Genial, te explico como trabajamos" }
    ]);

    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.turnIndex).toBe(0);
    expect(result.turns[0]?.candidateMessage).toBe("Hola, quiero informacion");
    expect(result.turns[0]?.generatedResponse).toBeTruthy();
    expect(result.turns[0]?.originalResponse).toBe("Hola, cuentame un poco de ti");
    expect(result.turns[1]?.turnIndex).toBe(1);
    expect(result.turns[1]?.candidateMessage).toBe("Tengo 23 anos y soy de Madrid");
    expect(result.turns[1]?.generatedResponse).toBeTruthy();
    expect(result.turns[1]?.originalResponse).toBe("Genial, te explico como trabajamos");
    for (const turn of result.turns) {
      expect(CandidateStateSchema.safeParse(turn.resultingState).success).toBe(true);
    }
    expect(result.providerTraces).toHaveLength(2);
    expect(result.turns[0]?.providerTrace.actualProvider).toBe("deterministic");
    expect(result.turns[0]?.providerTrace.usedFallback).toBe(false);
  });

  it("applies the planned state transitions between turns so late turns replay from the real state", async () => {
    const conversation = buildConversation([
      { role: "candidate", content: "Hola, me interesa. Tengo 24 años y soy de Valencia." },
      { role: "alex", content: "Genial, cuentame un poco mas de ti" },
      {
        role: "candidate",
        content: "Tengo experiencia creando contenido para Instagram, estoy disponible por las tardes y tengo iPhone 13."
      }
    ]);

    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.resultingState).toBe("QUALIFYING");
    expect(result.turns[1]?.resultingState).toBe("WAITING_HUMAN_REVIEW");
  });

  it("seeds the playback start from the imported conversation initial state", async () => {
    const conversation = buildConversation([{ role: "candidate", content: "Ya os acepte la solicitud" }], {
      initialState: "WAITING_PROFILE_ACCESS"
    });

    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });

    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]?.resultingState).toBe("PROFILE_READY_FOR_REVIEW");
  });

  it("does not feed agent, alex or system messages to the engine", async () => {
    const conversation = buildConversation([
      { role: "system", content: "Inicio de conversacion importada" },
      { role: "candidate", content: "Hola, quiero informacion" },
      { role: "agent", content: "Hola! Encantado" },
      { role: "alex", content: "Te leo" },
      { role: "candidate", content: "Tengo 23 anos y soy de Madrid" }
    ]);

    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });

    expect(result.turns).toHaveLength(2);
    expect(result.providerTraces).toHaveLength(2);
    expect(result.turns[0]?.originalResponse).toBe("Hola! Encantado\nTe leo");
    expect(result.turns[1]?.originalResponse).toBeNull();
  });

  it("falls back to inline corrected or original Alex annotations when no agent message follows", async () => {
    const conversation = buildConversation([
      {
        role: "candidate",
        content: "Hola, quiero informacion",
        originalAlexResponse: "Hola, dime",
        correctedResponse: "Hola, cuentame un poco de ti"
      },
      { role: "candidate", content: "Tengo 23 anos y soy de Madrid", originalAlexResponse: "Genial, gracias" }
    ]);

    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });

    expect(result.turns).toHaveLength(2);
    expect(result.turns[0]?.originalResponse).toBe("Hola, cuentame un poco de ti");
    expect(result.turns[1]?.originalResponse).toBe("Genial, gracias");
  });

  it("maps validator failures to suggested issues and keeps clean results without suggestions", async () => {
    expect(
      suggestEvaluationIssues(
        { valid: false },
        cleanStyleEvaluation({
          isTooFormal: true,
          isTooLong: true,
          repeatsKnownInformation: true,
          asksTooManyQuestions: true,
          addressesCandidateMessage: false
        })
      )
    ).toEqual(["FACTUAL_ERROR", "TOO_FORMAL", "TOO_LONG", "REPETITION", "UNNECESSARY_QUESTION", "MISSED_REAL_QUESTION"]);

    expect(suggestEvaluationIssues({ valid: true }, cleanStyleEvaluation())).toEqual([]);

    const conversation = buildConversation([{ role: "candidate", content: "Hola, quiero informacion" }]);
    const result = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });
    expect(result.turns[0]?.suggestedIssues).toEqual([]);
  });

  it("keeps playback turns of an evaluation session through a snapshot file roundtrip", async () => {
    const conversation = buildConversation([
      { role: "candidate", content: "Hola, quiero informacion" },
      { role: "alex", content: "Hola, cuentame un poco de ti" }
    ]);
    const playback = await playImportedConversation({ conversation, model: "gpt-5.4-mini" });
    const session = createEvaluationSession({
      conversationId: conversation.id,
      model: "gpt-5.4-mini",
      playbackTurns: playback.turns
    });

    const repository = new InMemoryEvaluationRepository();
    await repository.saveSession(session);

    const filePath = join(createTempDir(), "snapshot.json");
    saveSnapshotAtomic(filePath, { evaluationRepository: repository.toSnapshot() });
    const snapshot = loadSnapshot(filePath);
    expect(snapshot).not.toBeNull();

    const restored = new InMemoryEvaluationRepository();
    restored.restoreSnapshot(snapshot?.evaluationRepository);

    const restoredSession = await restored.getSession(session.id);
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.playbackTurns).toHaveLength(playback.turns.length);
    expect(restoredSession?.playbackTurns?.[0]?.candidateMessage).toBe("Hola, quiero informacion");
    expect(restoredSession?.playbackTurns?.[0]?.generatedResponse).toBe(playback.turns[0]?.generatedResponse);
    expect(restoredSession?.playbackTurns?.[0]?.originalResponse).toBe("Hola, cuentame un poco de ti");
    expect(restoredSession?.playbackTurns?.[0]?.providerTrace.actualProvider).toBe("deterministic");
  });

  it("still accepts legacy evaluation sessions without playback turns", () => {
    const parsed = EvaluationSessionSchema.safeParse({
      id: "legacy-1",
      conversationId: "conversation-1",
      model: "gpt-5.4-mini",
      createdAt: new Date(),
      turnFeedback: []
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.playbackTurns).toBeUndefined();
    }
  });

  it("uses playback provider traces for the session summary when feedback arrives without explicit traces", () => {
    const session = createEvaluationSession({
      conversationId: "conversation-1",
      model: "gpt-5.4-mini",
      playbackTurns: [buildPlaybackTurn(0), buildPlaybackTurn(1)]
    });

    const updated = addTurnFeedback(session, {
      turnIndex: 0,
      status: "APPROVED",
      originalResponse: "Respuesta generada 0",
      styleRating: 5,
      issues: []
    });

    expect(updated.summary?.approvedWithoutChangesPct).toBe(100);
    expect(updated.summary?.estimatedCostUsd).toBeCloseTo(0.02);
    expect(updated.summary?.averageLatencyMs).toBe(100);
  });
});
