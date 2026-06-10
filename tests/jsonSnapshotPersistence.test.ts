import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryImportedConversationRepository } from "@/application/conversationImport";
import { addTurnFeedback, createEvaluationSession, InMemoryEvaluationRepository } from "@/application/evaluationRunner";
import { InMemoryConversationFeedbackRepository, recordConversationFeedback } from "@/application/responseFeedback";
import { createCandidate, type ConversationMessage, type StateTransition } from "@/domain/candidate";
import type { ABEvaluationCase, ABModelRun } from "@/domain/evaluation";
import {
  createDebouncedPersister,
  loadSnapshot,
  saveSnapshotAtomic,
  wrapWithPersistence,
  type PersisterTimers
} from "@/infrastructure/persistence/jsonSnapshotStore";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rose-snapshot-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  vi.restoreAllMocks();
});

function buildMessage(candidateId: string): ConversationMessage {
  return {
    id: "message-1",
    candidateId,
    role: "candidate",
    author: "CANDIDATE",
    content: "Hola, tengo 23",
    externalMessageId: "external-1",
    createdAt: new Date("2026-06-01T10:00:00.000Z"),
    metadata: { inboundExternalMessageIds: "external-1" }
  };
}

function buildTransition(candidateId: string): StateTransition {
  return {
    id: "transition-1",
    candidateId,
    fromState: "NEW_LEAD",
    toState: "QUALIFYING",
    trigger: "CANDIDATE_MESSAGE",
    reason: "datos basicos recibidos",
    createdAt: new Date("2026-06-01T10:01:00.000Z")
  };
}

function buildModelRun(label: "A" | "B"): ABModelRun {
  return {
    label,
    model: `model-${label}`,
    response: `Respuesta ${label}`,
    stateAfter: "QUALIFYING",
    providerTrace: {
      requestedProvider: "deterministic",
      actualProvider: "deterministic",
      requestedModel: `model-${label}`,
      actualModel: `model-${label}`,
      usedFallback: false,
      fallbackReason: null,
      durationMs: 12,
      retryCount: 0,
      inputTokens: null,
      outputTokens: null,
      estimatedCostUsd: null
    },
    knowledgeEntryIds: [],
    retrievedExampleIds: [],
    factualValid: true,
    styleScore: 0.9
  };
}

function buildAbCase(): ABEvaluationCase {
  return {
    id: "ab-1",
    createdAt: new Date("2026-06-05T12:00:00.000Z"),
    blind: true,
    initialState: "NEW_LEAD",
    profileVisibility: "PUBLIC",
    messages: ["Hola, me interesa"],
    modelA: "model-A",
    modelB: "model-B",
    runA: buildModelRun("A"),
    runB: buildModelRun("B")
  };
}

describe("candidate repository snapshots", () => {
  it("roundtrips candidates, messages, transitions and negotiation decisions preserving Date instances", async () => {
    const repository = new InMemoryCandidateRepository();
    const candidate = await repository.saveCandidate(createCandidate({ instagramUsername: "snapshot_case" }));
    await repository.addMessage(buildMessage(candidate.id));
    await repository.addTransition(buildTransition(candidate.id));
    await repository.saveNegotiationDecision({
      candidateId: candidate.id,
      requestedModelPercentage: 80,
      currentPolicyAgencyPercentage: 30,
      currentPolicyModelPercentage: 70,
      decision: "ALLOW_CUSTOM_TERMS",
      approvedAgencyPercentage: 25,
      approvedModelPercentage: 75,
      reason: "excepcion aprobada",
      decidedBy: "Alex",
      decidedAt: new Date("2026-06-02T09:00:00.000Z")
    });

    const restored = new InMemoryCandidateRepository();
    restored.restoreSnapshot(repository.toSnapshot());

    const restoredCandidate = await restored.findCandidateById(candidate.id);
    expect(restoredCandidate).not.toBeNull();
    expect(restoredCandidate?.createdAt).toBeInstanceOf(Date);
    expect(restoredCandidate?.createdAt.getTime()).toBe(candidate.createdAt.getTime());
    expect(restoredCandidate?.currentState).toBe("NEW_LEAD");

    const messages = await restored.listMessages(candidate.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.createdAt).toBeInstanceOf(Date);
    expect(messages[0]?.content).toBe("Hola, tengo 23");
    expect(messages[0]?.metadata).toEqual({ inboundExternalMessageIds: "external-1" });

    const transitions = await restored.listTransitions(candidate.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.toState).toBe("QUALIFYING");
    expect(transitions[0]?.createdAt).toBeInstanceOf(Date);

    const decision = await restored.findApprovedNegotiationDecision(candidate.id);
    expect(decision?.decision).toBe("ALLOW_CUSTOM_TERMS");
    expect(decision?.decidedAt).toBeInstanceOf(Date);
  });

  it("normalizes legacy candidates on restore and skips invalid sections without throwing", async () => {
    const repository = new InMemoryCandidateRepository();

    expect(() => repository.restoreSnapshot(undefined)).not.toThrow();
    expect(() => repository.restoreSnapshot("garbage")).not.toThrow();
    expect(() =>
      repository.restoreSnapshot({
        candidates: [
          {
            id: "legacy-1",
            instagramUsername: "legacy_case",
            createdAt: "2026-05-01T08:00:00.000Z",
            updatedAt: "2026-05-02T08:00:00.000Z",
            profileVisibility: "PRIVATE"
          },
          { thisIs: "garbage" }
        ],
        messages: "not-an-array",
        transitions: [{ id: 1 }],
        negotiationDecisions: [{ candidateId: "legacy-1" }]
      })
    ).not.toThrow();

    const restored = await repository.findCandidateById("legacy-1");
    expect(restored).not.toBeNull();
    expect(restored?.createdAt).toBeInstanceOf(Date);
    expect(restored?.createdAt.toISOString()).toBe("2026-05-01T08:00:00.000Z");
    expect(restored?.declaredProfileVisibility).toBe("PRIVATE");
    expect(restored?.currentState).toBe("NEW_LEAD");
    expect(await repository.findCandidateById("undefined")).toBeNull();
  });
});

describe("evaluation repository snapshots", () => {
  it("roundtrips A/B cases with decisions and evaluation sessions through a snapshot file", async () => {
    const repository = new InMemoryEvaluationRepository();
    await repository.saveABCase(buildAbCase());
    await repository.recordABDecision({ id: "ab-1", winner: "B", styleRating: 4, note: "B suena mas natural" });

    let session = createEvaluationSession({ conversationId: "conversation-1", model: "model-A" });
    session = addTurnFeedback(session, {
      turnIndex: 0,
      status: "EDITED",
      originalResponse: "Hola!",
      editedResponse: "Hola, cuentame",
      styleRating: 3,
      issues: ["TOO_FORMAL"],
      note: "demasiado formal"
    });
    await repository.saveSession(session);

    const filePath = join(createTempDir(), "snapshot.json");
    saveSnapshotAtomic(filePath, { evaluationRepository: repository.toSnapshot() });
    const snapshot = loadSnapshot(filePath);
    expect(snapshot).not.toBeNull();

    const restored = new InMemoryEvaluationRepository();
    restored.restoreSnapshot(snapshot?.evaluationRepository);

    const cases = await restored.listABCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]?.winner).toBe("B");
    expect(cases[0]?.styleRating).toBe(4);
    expect(cases[0]?.createdAt).toBeInstanceOf(Date);
    expect(cases[0]?.runB.providerTrace.actualProvider).toBe("deterministic");

    const restoredSession = await restored.getSession(session.id);
    expect(restoredSession).not.toBeNull();
    expect(restoredSession?.createdAt).toBeInstanceOf(Date);
    expect(restoredSession?.turnFeedback).toHaveLength(1);
    expect(restoredSession?.turnFeedback[0]?.status).toBe("EDITED");
    expect(restoredSession?.turnFeedback[0]?.styleRating).toBe(3);
    expect(restoredSession?.summary?.editedPct).toBe(100);
  });

  it("skips invalid evaluation snapshot sections without throwing", async () => {
    const repository = new InMemoryEvaluationRepository();
    expect(() => repository.restoreSnapshot(null)).not.toThrow();
    expect(() => repository.restoreSnapshot({ abCases: [{ id: "broken" }], sessions: 42 })).not.toThrow();
    expect(await repository.listABCases()).toHaveLength(0);
  });
});

describe("date reviver", () => {
  it("revives only ISO strings whose key ends with At; ISO strings elsewhere stay strings", () => {
    const filePath = join(createTempDir(), "snapshot.json");
    saveSnapshotAtomic(filePath, {
      createdAt: new Date("2026-06-01T10:00:00.000Z"),
      content: "2026-06-01T10:00:00.000Z",
      editedAt: "ayer por la tarde",
      nested: {
        updatedAt: "2026-06-02T11:30:00.000Z",
        format: "2026-06-02T11:30:00.000Z"
      }
    });

    const snapshot = loadSnapshot(filePath);
    expect(snapshot?.createdAt).toBeInstanceOf(Date);
    expect(snapshot?.content).toBe("2026-06-01T10:00:00.000Z");
    expect(snapshot?.editedAt).toBe("ayer por la tarde");

    const nested = snapshot?.nested as Record<string, unknown>;
    expect(nested.updatedAt).toBeInstanceOf(Date);
    expect(nested.format).toBe("2026-06-02T11:30:00.000Z");
  });
});

describe("loadSnapshot", () => {
  it("returns null for a missing file", () => {
    expect(loadSnapshot(join(createTempDir(), "missing.json"))).toBeNull();
  });

  it("returns null for a corrupt snapshot file without throwing", () => {
    const filePath = join(createTempDir(), "snapshot.json");
    writeFileSync(filePath, "{ this is not json", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(loadSnapshot(filePath)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("returns null when the snapshot is valid JSON but not an object", () => {
    const filePath = join(createTempDir(), "snapshot.json");
    writeFileSync(filePath, "[1, 2, 3]", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(loadSnapshot(filePath)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("saveSnapshotAtomic", () => {
  it("creates missing directories, overwrites existing snapshots and leaves no tmp file", () => {
    const filePath = join(createTempDir(), "data", "snapshot.json");
    saveSnapshotAtomic(filePath, { version: 1 });
    saveSnapshotAtomic(filePath, { version: 2, savedAt: new Date("2026-06-09T00:00:00.000Z") });

    const snapshot = loadSnapshot(filePath);
    expect(snapshot?.version).toBe(2);
    expect(snapshot?.savedAt).toBeInstanceOf(Date);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });
});

describe("createDebouncedPersister", () => {
  function createManualTimers(): { timers: PersisterTimers; fire: () => void; pendingCount: () => number } {
    const pending = new Map<number, () => void>();
    let nextHandle = 1;
    return {
      timers: {
        setTimeout(callback) {
          const handle = nextHandle;
          nextHandle += 1;
          pending.set(handle, callback);
          return handle;
        },
        clearTimeout(handle) {
          if (typeof handle === "number") {
            pending.delete(handle);
          }
        }
      },
      fire() {
        for (const [handle, callback] of [...pending.entries()]) {
          pending.delete(handle);
          callback();
        }
      },
      pendingCount: () => pending.size
    };
  }

  it("debounces schedule calls into a single persist", () => {
    let persisted = 0;
    const manual = createManualTimers();
    const persister = createDebouncedPersister(
      () => {
        persisted += 1;
      },
      300,
      manual.timers
    );

    persister.schedule();
    persister.schedule();
    persister.schedule();
    expect(persisted).toBe(0);
    expect(manual.pendingCount()).toBe(1);

    manual.fire();
    expect(persisted).toBe(1);
  });

  it("flush persists immediately and clears any pending timer", () => {
    let persisted = 0;
    const manual = createManualTimers();
    const persister = createDebouncedPersister(
      () => {
        persisted += 1;
      },
      300,
      manual.timers
    );

    persister.schedule();
    persister.flush();
    expect(persisted).toBe(1);
    expect(manual.pendingCount()).toBe(0);

    manual.fire();
    expect(persisted).toBe(1);
  });

  it("does not propagate persist errors", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const persister = createDebouncedPersister(() => {
      throw new Error("disk full");
    }, 300);

    expect(() => persister.flush()).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("wrapWithPersistence", () => {
  it("schedules after mutating methods and not after read methods", async () => {
    const repository = new InMemoryCandidateRepository();
    let scheduled = 0;
    const wrapped = wrapWithPersistence(repository, () => {
      scheduled += 1;
    });

    const candidate = await wrapped.saveCandidate(createCandidate({ instagramUsername: "wrap_case" }));
    expect(scheduled).toBe(1);

    await wrapped.addMessage(buildMessage(candidate.id));
    expect(scheduled).toBe(2);

    await wrapped.listMessages(candidate.id);
    await wrapped.findCandidateById(candidate.id);
    await wrapped.listCandidates();
    expect(scheduled).toBe(2);
  });

  it("schedules only after an async mutating method resolves", async () => {
    const events: string[] = [];
    class FakeRepository {
      async saveItem(): Promise<string> {
        await Promise.resolve();
        events.push("resolved");
        return "ok";
      }
    }

    const wrapped = wrapWithPersistence(new FakeRepository(), () => {
      events.push("scheduled");
    });

    const pending = wrapped.saveItem();
    expect(events).toEqual([]);
    await expect(pending).resolves.toBe("ok");
    expect(events).toEqual(["resolved", "scheduled"]);
  });
});

describe("full simulator snapshot smoke", () => {
  it("persists every repository through one file and restores all state into fresh repositories", async () => {
    const filePath = join(createTempDir(), "simulator-snapshot.json");

    const candidateRepository = new InMemoryCandidateRepository();
    const feedbackRepository = new InMemoryConversationFeedbackRepository();
    const evaluationRepository = new InMemoryEvaluationRepository();
    const importedConversationRepository = new InMemoryImportedConversationRepository();

    const persister = createDebouncedPersister(() => {
      saveSnapshotAtomic(filePath, {
        candidateRepository: candidateRepository.toSnapshot(),
        feedbackRepository: feedbackRepository.toSnapshot(),
        evaluationRepository: evaluationRepository.toSnapshot(),
        importedConversationRepository: importedConversationRepository.toSnapshot()
      });
    }, 300);

    const wrappedCandidates = wrapWithPersistence(candidateRepository, persister.schedule);
    const wrappedFeedback = wrapWithPersistence(feedbackRepository, persister.schedule);
    const wrappedEvaluation = wrapWithPersistence(evaluationRepository, persister.schedule);
    const wrappedImports = wrapWithPersistence(importedConversationRepository, persister.schedule);

    const candidate = await wrappedCandidates.saveCandidate(createCandidate({ instagramUsername: "smoke_case" }));
    await wrappedCandidates.addMessage(buildMessage(candidate.id));
    await recordConversationFeedback(wrappedFeedback, {
      candidateId: candidate.id,
      status: "APPROVED",
      originalResponse: "Genial, cuentame un poco mas de ti",
      state: "QUALIFYING",
      contextSnapshot: "candidata interesada",
      styleRating: 5
    });
    await wrappedEvaluation.saveABCase(buildAbCase());
    await wrappedImports.importJson(
      JSON.stringify({
        version: "1",
        conversations: [
          {
            id: "imported-1",
            status: "ALEX_APPROVED",
            source: "ANONYMIZED_JSON",
            purpose: "EXAMPLE",
            messages: [{ role: "candidate", content: "Hola, me interesa la agencia" }],
            idealNextResponse: "Genial, cuentame un poco de ti"
          }
        ]
      })
    );

    persister.flush();
    const snapshot = loadSnapshot(filePath);
    expect(snapshot).not.toBeNull();

    const freshCandidates = new InMemoryCandidateRepository();
    const freshFeedback = new InMemoryConversationFeedbackRepository();
    const freshEvaluation = new InMemoryEvaluationRepository();
    const freshImports = new InMemoryImportedConversationRepository();

    freshCandidates.restoreSnapshot(snapshot?.candidateRepository);
    freshFeedback.restoreSnapshot(snapshot?.feedbackRepository);
    freshEvaluation.restoreSnapshot(snapshot?.evaluationRepository);
    freshImports.restoreSnapshot(snapshot?.importedConversationRepository);

    const restoredCandidate = await freshCandidates.findCandidateById(candidate.id);
    expect(restoredCandidate?.instagramUsername).toBe("smoke_case");
    expect(await freshCandidates.listMessages(candidate.id)).toHaveLength(1);

    const feedback = await freshFeedback.listFeedback(candidate.id);
    expect(feedback).toHaveLength(1);
    expect(feedback[0]?.styleRating).toBe(5);
    expect(feedback[0]?.createdAt).toBeInstanceOf(Date);
    const approvedResponses = await freshFeedback.listApprovedResponses();
    expect(approvedResponses).toHaveLength(1);
    expect(approvedResponses[0]?.approvedAt).toBeInstanceOf(Date);

    expect(await freshEvaluation.listABCases()).toHaveLength(1);

    const importedConversation = await freshImports.get("imported-1");
    expect(importedConversation?.status).toBe("ALEX_APPROVED");
    expect(importedConversation?.idealNextResponse).toBe("Genial, cuentame un poco de ti");
  });
});
