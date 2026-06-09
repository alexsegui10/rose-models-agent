import { alexStyleProfile } from "@/content/style/alex-style-profile";
import type { CandidateState } from "@/domain/candidate";
import type { AlexStyleRating, ApprovedResponse, ConversationFeedback, ConversationFeedbackStatus } from "@/domain/styleEvaluation";

export interface CreateConversationFeedbackInput {
  candidateId: string;
  messageId?: string;
  status: ConversationFeedbackStatus;
  originalResponse: string;
  editedResponse?: string;
  reason?: string;
  styleRating?: AlexStyleRating;
  state: CandidateState;
  contextSnapshot: string;
  modelVersion?: string;
}

export interface ConversationFeedbackRepository {
  saveFeedback(feedback: ConversationFeedback): Promise<ConversationFeedback>;
  listFeedback(candidateId?: string): Promise<ConversationFeedback[]>;
  saveApprovedResponse(response: ApprovedResponse): Promise<ApprovedResponse>;
  listApprovedResponses(): Promise<ApprovedResponse[]>;
}

export class InMemoryConversationFeedbackRepository implements ConversationFeedbackRepository {
  private readonly feedback = new Map<string, ConversationFeedback>();
  private readonly approvedResponses = new Map<string, ApprovedResponse>();

  async saveFeedback(feedback: ConversationFeedback): Promise<ConversationFeedback> {
    this.feedback.set(feedback.id, feedback);
    return feedback;
  }

  async listFeedback(candidateId?: string): Promise<ConversationFeedback[]> {
    const values = [...this.feedback.values()];
    return candidateId ? values.filter((item) => item.candidateId === candidateId) : values;
  }

  async saveApprovedResponse(response: ApprovedResponse): Promise<ApprovedResponse> {
    this.approvedResponses.set(response.id, response);
    return response;
  }

  async listApprovedResponses(): Promise<ApprovedResponse[]> {
    return [...this.approvedResponses.values()];
  }
}

export async function recordConversationFeedback(
  repository: ConversationFeedbackRepository,
  input: CreateConversationFeedbackInput
): Promise<{ feedback: ConversationFeedback; approvedResponse?: ApprovedResponse }> {
  const feedback: ConversationFeedback = {
    id: crypto.randomUUID(),
    candidateId: input.candidateId,
    messageId: input.messageId,
    status: input.status,
    originalResponse: input.originalResponse,
    editedResponse: input.editedResponse,
    reason: input.reason,
    styleRating: input.styleRating,
    state: input.state,
    contextSnapshot: input.contextSnapshot,
    createdAt: new Date(),
    styleProfileVersion: alexStyleProfile.version,
    promptVersion: alexStyleProfile.promptVersion,
    modelVersion: input.modelVersion ?? "deterministic-local-2026-06-08.1"
  };

  await repository.saveFeedback(feedback);

  if (input.status !== "APPROVED") {
    return { feedback };
  }

  const approvedResponse: ApprovedResponse = {
    id: crypto.randomUUID(),
    feedbackId: feedback.id,
    response: input.editedResponse ?? input.originalResponse,
    state: input.state,
    tags: [],
    approvedAt: new Date(),
    styleProfileVersion: alexStyleProfile.version,
    promptVersion: alexStyleProfile.promptVersion,
    modelVersion: feedback.modelVersion
  };

  await repository.saveApprovedResponse(approvedResponse);

  return { feedback, approvedResponse };
}
