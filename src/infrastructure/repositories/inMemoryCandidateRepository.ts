import type { NegotiationDecision } from "@/domain/businessKnowledge";
import { normalizeCandidate, type Candidate, type ConversationMessage, type StateTransition } from "@/domain/candidate";
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

  async saveCandidate(candidate: Candidate): Promise<Candidate> {
    return this.normalizeAndStore(candidate);
  }

  async listMessages(candidateId: string, limit = 50): Promise<ConversationMessage[]> {
    return this.messages.filter((message) => message.candidateId === candidateId).slice(-limit);
  }

  async findMessageByExternalId(candidateId: string, externalMessageId: string): Promise<ConversationMessage | null> {
    return this.messages.find((message) => message.candidateId === candidateId && message.externalMessageId === externalMessageId) ?? null;
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

  private normalizeAndStore(candidate: Candidate): Candidate {
    const normalized = normalizeCandidate(candidate);
    this.candidates.set(normalized.id, normalized);
    return normalized;
  }
}
