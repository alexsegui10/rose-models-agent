import type { Candidate, ConversationMessage } from "@/domain/candidate";

export interface DebouncePolicy {
  windowMs: number;
  maxMessagesPerTurn: number;
  joinWith: string;
}

export const defaultDebouncePolicy: DebouncePolicy = {
  windowMs: 1200,
  maxMessagesPerTurn: 8,
  joinWith: "\n"
};

export interface IncomingTurnMessage {
  content: string;
  externalMessageId?: string;
  receivedAt?: Date;
}

export interface CandidateLock {
  candidateId: string;
  acquiredAt: Date;
  expiresAt: Date;
  owner: string;
}

export interface CandidateLockProvider {
  withCandidateLock<T>(candidateId: string, operation: () => Promise<T>): Promise<T>;
}

export interface GenerationCancellationToken {
  candidateId: string;
  version: number;
  cancelled: boolean;
}

export interface GenerationCancellationProvider {
  issue(candidate: Candidate): GenerationCancellationToken;
  cancel(candidateId: string): Promise<void>;
  isCurrent(token: GenerationCancellationToken, candidate: Candidate): boolean;
}

export interface AutomationSendGuard {
  canSend(input: { candidate: Candidate; outboundMessage: string; tokenVersion: number }): Promise<{
    allowed: boolean;
    reason: string | null;
    latestCandidate: Candidate;
  }>;
}

export interface DuplicatePreventionResult {
  duplicateInbound: boolean;
  duplicateTransition: boolean;
  duplicateOutbound: boolean;
  previousMessage: ConversationMessage | null;
}

export function groupMessagesForTurn(messages: IncomingTurnMessage[], policy: DebouncePolicy = defaultDebouncePolicy): IncomingTurnMessage {
  const selected = messages.slice(0, policy.maxMessagesPerTurn);

  return {
    content: selected.map((message) => message.content.trim()).filter(Boolean).join(policy.joinWith),
    externalMessageId: selected.map((message) => message.externalMessageId).filter(Boolean).join("|") || undefined,
    receivedAt: selected[selected.length - 1]?.receivedAt ?? new Date()
  };
}

