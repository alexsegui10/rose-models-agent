import type { NegotiationDecision } from "@/domain/businessKnowledge";
import type { Candidate, ConversationMessage, StateTransition } from "@/domain/candidate";

export interface CandidateRepository {
  findCandidateById(id: string): Promise<Candidate | null>;
  findCandidateByInstagram(instagramUsername: string): Promise<Candidate | null>;
  listCandidates(): Promise<Candidate[]>;
  saveCandidate(candidate: Candidate): Promise<Candidate>;
  listMessages(candidateId: string, limit?: number): Promise<ConversationMessage[]>;
  findMessageByExternalId(candidateId: string, externalMessageId: string): Promise<ConversationMessage | null>;
  addMessage(message: ConversationMessage): Promise<void>;
  listTransitions(candidateId: string): Promise<StateTransition[]>;
  addTransition(transition: StateTransition): Promise<void>;
  findApprovedNegotiationDecision(candidateId: string): Promise<NegotiationDecision | null>;
  saveNegotiationDecision(decision: NegotiationDecision): Promise<NegotiationDecision>;
}
