import { ConversationEngine, type HandleIncomingMessageResult } from "./conversationEngine";
import { createLlmProviders } from "./llmFactory";
import { DeterministicUnderstandingProvider } from "./dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "./businessKnowledgeRetriever";
import { LocalExampleRetriever } from "./exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import type { CandidateState, ProfileVisibility } from "@/domain/candidate";
import type {
  ABModelRun,
  ABEvaluationCase,
  ABWinner,
  EvaluationIssue,
  EvaluationSession,
  EvaluationSessionSummary,
  EvaluationTurnFeedback,
  ProviderCallTrace
} from "@/domain/evaluation";
import type { AlexStyleRating } from "@/domain/styleEvaluation";

export interface RunABEvaluationInput {
  messages: string[];
  initialState?: CandidateState;
  profileVisibility?: ProfileVisibility;
  modelA?: string;
  modelB?: string;
  blind?: boolean;
  openaiApiKey?: string;
}

export class InMemoryEvaluationRepository {
  private readonly abCases = new Map<string, ABEvaluationCase>();
  private readonly sessions = new Map<string, EvaluationSession>();

  async saveABCase(abCase: ABEvaluationCase): Promise<ABEvaluationCase> {
    this.abCases.set(abCase.id, abCase);
    return abCase;
  }

  async listABCases(): Promise<ABEvaluationCase[]> {
    return [...this.abCases.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async recordABDecision(input: {
    id: string;
    winner: ABWinner;
    styleRating?: AlexStyleRating;
    note?: string;
  }): Promise<ABEvaluationCase> {
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

export function createEvaluationSession(input: { conversationId: string; model: string }): EvaluationSession {
  return {
    id: crypto.randomUUID(),
    conversationId: input.conversationId,
    model: input.model,
    createdAt: new Date(),
    turnFeedback: []
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
  return {
    ...session,
    turnFeedback,
    summary: summarizeSession(session.model, turnFeedback, providerTraces)
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

function traceFromResult(result: HandleIncomingMessageResult): ProviderCallTrace {
  return {
    requestedProvider: result.draft.requestedProvider,
    actualProvider: result.draft.actualProvider,
    requestedModel: result.draft.requestedModel,
    actualModel: result.draft.actualModel,
    usedFallback: result.draft.usedFallback,
    fallbackReason: result.draft.fallbackReason ?? result.draft.error ?? null,
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
