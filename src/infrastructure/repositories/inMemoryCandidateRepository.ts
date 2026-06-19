import { NegotiationDecisionSchema, type NegotiationDecision } from "@/domain/businessKnowledge";
import {
  CandidateStateSchema,
  ConversationAuthorSchema,
  ConversationRoleSchema,
  normalizeCandidate,
  OUTREACH_EXCLUDED_STATES,
  type Candidate,
  type CandidateNormalizationInput,
  type ConversationMessage,
  type StateTransition
} from "@/domain/candidate";
import type { CandidateRepository } from "./types";

export class InMemoryCandidateRepository implements CandidateRepository {
  private readonly candidates = new Map<string, Candidate>();
  private readonly messages: ConversationMessage[] = [];
  private readonly transitions: StateTransition[] = [];
  private readonly negotiationDecisions = new Map<string, NegotiationDecision>();

  async findCandidateById(id: string): Promise<Candidate | null> {
    const candidate = this.candidates.get(id);
    return candidate ? this.normalizeAndStore(candidate) : null;
  }

  async findCandidateByInstagram(instagramUsername: string): Promise<Candidate | null> {
    const normalized = instagramUsername.toLowerCase();
    const candidate = [...this.candidates.values()].find((item) => item.instagramUsername.toLowerCase() === normalized);
    return candidate ? this.normalizeAndStore(candidate) : null;
  }

  async listCandidates(): Promise<Candidate[]> {
    return [...this.candidates.values()]
      .map((candidate) => this.normalizeAndStore(candidate))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async listBookedCallStarts(): Promise<number[]> {
    return [...this.candidates.values()]
      .map((candidate) => normalizeCandidate(candidate))
      .filter((candidate) => candidate.currentState === "CALL_SCHEDULED" && candidate.scheduledCallStartMs !== undefined)
      .map((candidate) => candidate.scheduledCallStartMs as number);
  }

  async listCandidatesForOutreach(idleSinceMs: number): Promise<Candidate[]> {
    return [...this.candidates.values()]
      .map((candidate) => normalizeCandidate(candidate))
      .filter(
        (candidate) =>
          !OUTREACH_EXCLUDED_STATES.has(candidate.currentState) &&
          !candidate.manualControlActive &&
          !candidate.automationPaused &&
          candidate.lastMessageAt !== undefined &&
          candidate.lastMessageAt.getTime() <= idleSinceMs
      );
  }

  async saveCandidate(candidate: Candidate): Promise<Candidate> {
    return this.normalizeAndStore(candidate);
  }

  async deleteCandidate(id: string): Promise<void> {
    this.candidates.delete(id);
    this.negotiationDecisions.delete(id);
    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      if (this.messages[index].candidateId === id) {
        this.messages.splice(index, 1);
      }
    }
    for (let index = this.transitions.length - 1; index >= 0; index -= 1) {
      if (this.transitions[index].candidateId === id) {
        this.transitions.splice(index, 1);
      }
    }
  }

  async listMessages(candidateId: string, limit = 50): Promise<ConversationMessage[]> {
    return this.messages.filter((message) => message.candidateId === candidateId).slice(-limit);
  }

  async findMessageByExternalId(candidateId: string, externalMessageId: string): Promise<ConversationMessage | null> {
    return (
      this.messages.find((message) => message.candidateId === candidateId && message.externalMessageId === externalMessageId) ??
      null
    );
  }

  async addMessage(message: ConversationMessage): Promise<void> {
    if (message.externalMessageId) {
      const existing = await this.findMessageByExternalId(message.candidateId, message.externalMessageId);
      if (existing) {
        return;
      }
    }

    const inboundExternalMessageIds = message.metadata?.inboundExternalMessageIds;
    if (message.role === "agent" && typeof inboundExternalMessageIds === "string") {
      const duplicateOutbound = this.messages.find(
        (existing) =>
          existing.candidateId === message.candidateId &&
          existing.role === "agent" &&
          existing.content === message.content &&
          existing.metadata?.inboundExternalMessageIds === inboundExternalMessageIds
      );
      if (duplicateOutbound) {
        return;
      }
    }

    this.messages.push(message);
  }

  async listTransitions(candidateId: string): Promise<StateTransition[]> {
    return this.transitions.filter((transition) => transition.candidateId === candidateId);
  }

  async addTransition(transition: StateTransition): Promise<void> {
    const duplicateTransition = this.transitions.find(
      (existing) =>
        existing.candidateId === transition.candidateId &&
        existing.fromState === transition.fromState &&
        existing.toState === transition.toState &&
        existing.trigger === transition.trigger &&
        existing.reason === transition.reason
    );
    if (duplicateTransition) {
      return;
    }

    this.transitions.push(transition);
  }

  async findApprovedNegotiationDecision(candidateId: string): Promise<NegotiationDecision | null> {
    const decision = this.negotiationDecisions.get(candidateId) ?? null;
    return decision?.decision === "ALLOW_CUSTOM_TERMS" ? decision : null;
  }

  async saveNegotiationDecision(decision: NegotiationDecision): Promise<NegotiationDecision> {
    this.negotiationDecisions.set(decision.candidateId, decision);
    return decision;
  }

  toSnapshot(): unknown {
    return {
      candidates: [...this.candidates.values()],
      messages: [...this.messages],
      transitions: [...this.transitions],
      negotiationDecisions: [...this.negotiationDecisions.values()]
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!isRecord(data)) {
      return;
    }

    if (Array.isArray(data.candidates)) {
      this.candidates.clear();
      for (const item of data.candidates) {
        const candidate = reviveCandidate(item);
        if (candidate) {
          this.candidates.set(candidate.id, candidate);
        }
      }
    }

    if (Array.isArray(data.messages)) {
      this.messages.length = 0;
      for (const item of data.messages) {
        const message = reviveMessage(item);
        if (message) {
          this.messages.push(message);
        }
      }
    }

    if (Array.isArray(data.transitions)) {
      this.transitions.length = 0;
      for (const item of data.transitions) {
        const transition = reviveTransition(item);
        if (transition) {
          this.transitions.push(transition);
        }
      }
    }

    if (Array.isArray(data.negotiationDecisions)) {
      this.negotiationDecisions.clear();
      for (const item of data.negotiationDecisions) {
        const decision = reviveNegotiationDecision(item);
        if (decision) {
          this.negotiationDecisions.set(decision.candidateId, decision);
        }
      }
    }
  }

  private normalizeAndStore(candidate: Candidate): Candidate {
    const normalized = normalizeCandidate(candidate);
    this.candidates.set(normalized.id, normalized);
    return normalized;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function reviveCandidate(value: unknown): Candidate | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }

  try {
    return normalizeCandidate(value as CandidateNormalizationInput);
  } catch {
    return null;
  }
}

function reviveMessage(value: unknown): ConversationMessage | null {
  if (!isRecord(value)) {
    return null;
  }

  const createdAt = toDate(value.createdAt);
  const role = ConversationRoleSchema.safeParse(value.role);
  const author = ConversationAuthorSchema.safeParse(value.author);
  if (
    typeof value.id !== "string" ||
    typeof value.candidateId !== "string" ||
    typeof value.content !== "string" ||
    !createdAt ||
    !role.success ||
    !author.success
  ) {
    return null;
  }

  return {
    id: value.id,
    candidateId: value.candidateId,
    role: role.data,
    author: author.data,
    content: value.content,
    externalMessageId: typeof value.externalMessageId === "string" ? value.externalMessageId : undefined,
    createdAt,
    metadata: reviveMessageMetadata(value.metadata)
  };
}

function reviveMessageMetadata(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      metadata[key] = entry;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function reviveTransition(value: unknown): StateTransition | null {
  if (!isRecord(value)) {
    return null;
  }

  const createdAt = toDate(value.createdAt);
  const fromState = CandidateStateSchema.safeParse(value.fromState);
  const toState = CandidateStateSchema.safeParse(value.toState);
  if (
    typeof value.id !== "string" ||
    typeof value.candidateId !== "string" ||
    typeof value.trigger !== "string" ||
    typeof value.reason !== "string" ||
    !createdAt ||
    !fromState.success ||
    !toState.success
  ) {
    return null;
  }

  return {
    id: value.id,
    candidateId: value.candidateId,
    fromState: fromState.data,
    toState: toState.data,
    trigger: value.trigger,
    reason: value.reason,
    createdAt
  };
}

function reviveNegotiationDecision(value: unknown): NegotiationDecision | null {
  if (!isRecord(value)) {
    return null;
  }

  const decidedAt = toDate(value.decidedAt);
  const parsed = NegotiationDecisionSchema.safeParse(decidedAt ? { ...value, decidedAt } : value);
  return parsed.success ? parsed.data : null;
}
