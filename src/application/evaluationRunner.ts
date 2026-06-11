import { ConversationEngine, type HandleIncomingMessageResult } from "./conversationEngine";
import type { ImportedConversation } from "./conversationImport";
import { createLlmProviders } from "./llmFactory";
import { DeterministicUnderstandingProvider } from "./dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "./businessKnowledgeRetriever";
import { LocalExampleRetriever } from "./exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, type Candidate, type CandidateState, type ProfileVisibility } from "@/domain/candidate";
import {
  ABEvaluationCaseSchema,
  EvaluationSessionSchema,
  type ABModelRun,
  type ABEvaluationCase,
  type EvaluationIssue,
  type EvaluationSession,
  type EvaluationSessionSummary,
  type EvaluationTurnFeedback,
  type PlaybackTurn,
  type ProviderCallTrace
} from "@/domain/evaluation";
import type { AlexStyleRating, StyleEvaluation } from "@/domain/styleEvaluation";
import type { EvaluationRepository, RecordABDecisionInput } from "@/infrastructure/repositories/types";

export interface RunABEvaluationInput {
  messages: string[];
  initialState?: CandidateState;
  profileVisibility?: ProfileVisibility;
  modelA?: string;
  modelB?: string;
  blind?: boolean;
  openaiApiKey?: string;
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly abCases = new Map<string, ABEvaluationCase>();
  private readonly sessions = new Map<string, EvaluationSession>();

  async saveABCase(abCase: ABEvaluationCase): Promise<ABEvaluationCase> {
    this.abCases.set(abCase.id, abCase);
    return abCase;
  }

  async listABCases(): Promise<ABEvaluationCase[]> {
    return [...this.abCases.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async recordABDecision(input: RecordABDecisionInput): Promise<ABEvaluationCase> {
    const existing = this.abCases.get(input.id);
    if (!existing) throw new Error("AB evaluation not found.");

    const updated: ABEvaluationCase = {
      ...existing,
      winner: input.winner,
      styleRating: input.styleRating,
      note: input.note
    };
    this.abCases.set(updated.id, updated);
    return updated;
  }

  async saveSession(session: EvaluationSession): Promise<EvaluationSession> {
    this.sessions.set(session.id, session);
    return session;
  }

  async getSession(id: string): Promise<EvaluationSession | null> {
    return this.sessions.get(id) ?? null;
  }

  async listSessions(): Promise<EvaluationSession[]> {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  toSnapshot(): unknown {
    return {
      abCases: [...this.abCases.values()],
      sessions: [...this.sessions.values()]
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!isSnapshotRecord(data)) {
      return;
    }

    if (Array.isArray(data.abCases)) {
      this.abCases.clear();
      for (const item of data.abCases) {
        const parsed = ABEvaluationCaseSchema.safeParse(item);
        if (parsed.success) {
          this.abCases.set(parsed.data.id, parsed.data);
        }
      }
    }

    if (Array.isArray(data.sessions)) {
      this.sessions.clear();
      for (const item of data.sessions) {
        const parsed = EvaluationSessionSchema.safeParse(item);
        if (parsed.success) {
          this.sessions.set(parsed.data.id, parsed.data);
        }
      }
    }
  }
}

function isSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runABEvaluation(input: RunABEvaluationInput): Promise<ABEvaluationCase> {
  const modelA = input.modelA ?? process.env.AB_MODEL_A ?? "gpt-5.4-nano";
  const modelB = input.modelB ?? process.env.AB_MODEL_B ?? "gpt-5.4-mini";
  const sharedKnowledgeRetriever = new LocalBusinessKnowledgeRetriever();
  const sharedExampleRetriever = new LocalExampleRetriever();
  const runA = await runModelConversation("A", modelA, input, sharedKnowledgeRetriever, sharedExampleRetriever);
  const runB = await runModelConversation("B", modelB, input, sharedKnowledgeRetriever, sharedExampleRetriever);

  return {
    id: crypto.randomUUID(),
    createdAt: new Date(),
    blind: input.blind ?? true,
    initialState: input.initialState ?? "NEW_LEAD",
    profileVisibility: input.profileVisibility ?? "PUBLIC",
    messages: input.messages,
    modelA,
    modelB,
    runA,
    runB
  };
}

export interface PlayImportedConversationInput {
  conversation: ImportedConversation;
  model: string;
  openaiApiKey?: string;
}

export interface PlayImportedConversationResult {
  turns: PlaybackTurn[];
  providerTraces: ProviderCallTrace[];
}

export async function playImportedConversation(input: PlayImportedConversationInput): Promise<PlayImportedConversationResult> {
  const repository = new InMemoryCandidateRepository();
  const env = {
    ...process.env,
    LLM_MODE: input.openaiApiKey ? "OPENAI" : "DETERMINISTIC",
    OPENAI_API_KEY: input.openaiApiKey ?? process.env.OPENAI_API_KEY,
    OPENAI_UNDERSTANDING_MODEL: input.model,
    OPENAI_WRITING_MODEL: input.model,
    AUTOMATION_MODE: "DRAFT_ONLY"
  } as NodeJS.ProcessEnv;
  const providers = createLlmProviders(env);
  const engine = new ConversationEngine({
    repository,
    understandingProvider:
      providers.config.llmMode === "OPENAI" ? providers.understandingProvider : new DeterministicUnderstandingProvider(),
    draftingProvider: providers.draftingProvider,
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "DRAFT_ONLY"
  });

  const turns: PlaybackTurn[] = [];
  const providerTraces: ProviderCallTrace[] = [];
  const username = `playback_${crypto.randomUUID()}`;
  let candidateId: string | undefined;

  if (input.conversation.initialState !== "NEW_LEAD") {
    const seededCandidate = await repository.saveCandidate({
      ...createCandidate({ instagramUsername: username, profileVisibility: "PUBLIC" }),
      currentState: input.conversation.initialState
    });
    candidateId = seededCandidate.id;
  }

  for (let index = 0; index < input.conversation.messages.length; index += 1) {
    const message = input.conversation.messages[index];
    if (!message || message.role !== "candidate") {
      continue;
    }
    // El share del anuncio llega como "[archivo adjunto]" antes del CTA real; Alex nunca
    // lo responde en la realidad, asi que no es un turno evaluable.
    if (isAttachmentPlaceholder(message.content)) {
      continue;
    }

    const result = await engine.handleIncomingMessage({
      candidateId,
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: message.content
    });
    const playbackCandidate = await applyPlannedPlaybackTransitions(repository, result);
    candidateId = playbackCandidate.id;

    const providerTrace = traceFromResult(result);
    providerTraces.push(providerTrace);
    turns.push({
      turnIndex: turns.length,
      candidateMessage: message.content,
      generatedResponse: result.response,
      originalResponse: originalResponseFor(input.conversation.messages, index),
      resultingState: playbackCandidate.currentState,
      suggestedIssues: suggestEvaluationIssues(result.factualValidation, result.styleEvaluation),
      providerTrace
    });
  }

  return { turns, providerTraces };
}

/**
 * Solo para playback de evaluacion: aplica al candidato EFIMERO las transiciones que el motor
 * planifico de forma determinista pero no persistio porque corre en DRAFT_ONLY. Replica lo que
 * hace la rama de envio del motor para que cada turno se reproduzca desde el estado real.
 */
async function applyPlannedPlaybackTransitions(
  repository: InMemoryCandidateRepository,
  result: HandleIncomingMessageResult
): Promise<Candidate> {
  if (result.plannedTransitions.length === 0) {
    return result.candidate;
  }

  let candidate = result.candidate;
  for (const transition of result.plannedTransitions) {
    await repository.addTransition(transition);
    candidate = {
      ...candidate,
      currentState: transition.toState,
      humanReviewStatus: transition.toState === "WAITING_HUMAN_REVIEW" ? "PENDING" : candidate.humanReviewStatus,
      humanReviewReason:
        transition.toState === "HUMAN_INTERVENTION_REQUIRED"
          ? (result.responsePlan.humanReviewReason ?? candidate.humanReviewReason)
          : candidate.humanReviewReason,
      updatedAt: new Date()
    };
  }

  return repository.saveCandidate(candidate);
}

export function suggestEvaluationIssues(
  factualValidation: { valid: boolean },
  styleEvaluation: StyleEvaluation
): EvaluationIssue[] {
  const issues: EvaluationIssue[] = [];
  if (!factualValidation.valid) issues.push("FACTUAL_ERROR");
  if (styleEvaluation.isTooFormal) issues.push("TOO_FORMAL");
  if (styleEvaluation.isTooLong) issues.push("TOO_LONG");
  if (styleEvaluation.repeatsKnownInformation) issues.push("REPETITION");
  if (styleEvaluation.asksTooManyQuestions) issues.push("UNNECESSARY_QUESTION");
  if (!styleEvaluation.addressesCandidateMessage) issues.push("MISSED_REAL_QUESTION");
  return issues;
}

function isAttachmentPlaceholder(content: string): boolean {
  const normalized = content.trim().toLowerCase();
  return normalized === "[archivo adjunto]" || normalized.length === 0;
}

function originalResponseFor(messages: ImportedConversation["messages"], candidateIndex: number): string | null {
  const followUps: string[] = [];
  for (let index = candidateIndex + 1; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message || message.role === "candidate") {
      break;
    }
    if (message.role === "agent" || message.role === "alex") {
      followUps.push(message.content);
    }
  }
  if (followUps.length > 0) {
    return followUps.join("\n");
  }

  const candidateMessage = messages[candidateIndex];
  return candidateMessage?.correctedResponse ?? candidateMessage?.originalAlexResponse ?? null;
}

export function createEvaluationSession(input: {
  conversationId: string;
  model: string;
  playbackTurns?: PlaybackTurn[];
}): EvaluationSession {
  return {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    model: input.model,
    createdAt: new Date(),
    turnFeedback: [],
    playbackTurns: input.playbackTurns
  };
}

export function addTurnFeedback(
  session: EvaluationSession,
  feedback: EvaluationTurnFeedback,
  providerTraces: ProviderCallTrace[] = []
): EvaluationSession {
  const turnFeedback = [...session.turnFeedback.filter((item) => item.turnIndex !== feedback.turnIndex), feedback].sort(
    (a, b) => a.turnIndex - b.turnIndex
  );
  const traces = providerTraces.length > 0 ? providerTraces : (session.playbackTurns ?? []).map((turn) => turn.providerTrace);
  return {
    ...session,
    turnFeedback,
    summary: summarizeSession(session.model, turnFeedback, traces)
  };
}

export function summarizeSession(
  model: string,
  feedback: EvaluationTurnFeedback[],
  providerTraces: ProviderCallTrace[] = []
): EvaluationSessionSummary {
  const total = Math.max(feedback.length, 1);
  const ratings = feedback.map((item) => item.styleRating).filter((value): value is AlexStyleRating => typeof value === "number");
  const countIssue = (issue: EvaluationIssue) => feedback.filter((item) => item.issues.includes(issue)).length;
  const totalCost = providerTraces.reduce((sum, trace) => sum + (trace.estimatedCostUsd ?? 0), 0);
  const averageLatencyMs =
    providerTraces.length > 0 ? providerTraces.reduce((sum, trace) => sum + trace.durationMs, 0) / providerTraces.length : 0;

  return {
    approvedWithoutChangesPct: (feedback.filter((item) => item.status === "APPROVED").length / total) * 100,
    editedPct: (feedback.filter((item) => item.status === "EDITED").length / total) * 100,
    rejectedPct: (feedback.filter((item) => item.status === "REJECTED").length / total) * 100,
    averageStyleRating: ratings.length > 0 ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null,
    factualErrors: countIssue("FACTUAL_ERROR"),
    stateFailures: countIssue("STATE_ERROR"),
    repetitions: countIssue("REPETITION"),
    model,
    estimatedCostUsd: totalCost,
    averageLatencyMs
  };
}

async function runModelConversation(
  label: "A" | "B",
  model: string,
  input: RunABEvaluationInput,
  businessKnowledgeRetriever: LocalBusinessKnowledgeRetriever,
  exampleRetriever: LocalExampleRetriever
): Promise<ABModelRun> {
  const repository = new InMemoryCandidateRepository();
  const env = {
    ...process.env,
    LLM_MODE: input.openaiApiKey ? "OPENAI" : "DETERMINISTIC",
    OPENAI_API_KEY: input.openaiApiKey ?? process.env.OPENAI_API_KEY,
    OPENAI_UNDERSTANDING_MODEL: model,
    OPENAI_WRITING_MODEL: model,
    AUTOMATION_MODE: "DRAFT_ONLY"
  } as NodeJS.ProcessEnv;
  const providers = createLlmProviders(env);
  const engine = new ConversationEngine({
    repository,
    understandingProvider:
      providers.config.llmMode === "OPENAI" ? providers.understandingProvider : new DeterministicUnderstandingProvider(),
    draftingProvider: providers.draftingProvider,
    businessKnowledgeRetriever,
    exampleRetriever,
    automationMode: "DRAFT_ONLY"
  });

  let latest: HandleIncomingMessageResult | null = null;
  let candidateId: string | undefined;
  const username = `ab_${label.toLowerCase()}_${crypto.randomUUID()}`;

  for (const message of input.messages) {
    latest = await engine.handleIncomingMessage({
      candidateId,
      instagramUsername: username,
      profileVisibility: input.profileVisibility ?? "PUBLIC",
      message
    });
    candidateId = latest.candidate.id;
  }

  if (!latest) throw new Error("A/B evaluation requires at least one message.");

  return {
    label,
    model,
    response: latest.response,
    stateAfter: latest.candidate.currentState,
    providerTrace: traceFromResult(latest),
    knowledgeEntryIds: latest.responsePlan.knowledgeEntryIds,
    retrievedExampleIds: latest.retrievedExamples.map((example) => example.id),
    factualValid: latest.factualValidation.valid,
    styleScore: latest.styleEvaluation.score
  };
}

/**
 * Traza combinada del turno (comprension + redaccion). Invariante 6: si CUALQUIERA de las dos
 * llamadas uso fallback, la traza lo dice y el motivo identifica la etapa ("comprension: ..." /
 * "redaccion: ..."). Antes solo se reflejaba la redaccion y un fallback de comprension era
 * invisible en la UI. Exportada para tests.
 */
export function traceFromResult(result: Pick<HandleIncomingMessageResult, "understanding" | "draft">): ProviderCallTrace {
  const fallbackReasons: string[] = [];
  if (result.understanding.usedFallback) {
    fallbackReasons.push(`comprension: ${result.understanding.fallbackReason ?? "motivo desconocido"}`);
  }
  if (result.draft.usedFallback) {
    fallbackReasons.push(`redaccion: ${result.draft.fallbackReason ?? result.draft.error ?? "motivo desconocido"}`);
  }

  return {
    requestedProvider: result.draft.requestedProvider,
    actualProvider: result.draft.actualProvider,
    requestedModel: result.draft.requestedModel,
    actualModel: result.draft.actualModel,
    usedFallback: result.understanding.usedFallback || result.draft.usedFallback,
    fallbackReason: fallbackReasons.length > 0 ? fallbackReasons.join(" | ") : null,
    durationMs: result.draft.durationMs + result.understanding.durationMs,
    retryCount: result.draft.retryCount + result.understanding.retryCount,
    inputTokens: sumNullable(result.draft.inputTokens, result.understanding.inputTokens),
    outputTokens: sumNullable(result.draft.outputTokens, result.understanding.outputTokens),
    estimatedCostUsd: sumNullable(result.draft.estimatedCostUsd, result.understanding.estimatedCostUsd)
  };
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}
