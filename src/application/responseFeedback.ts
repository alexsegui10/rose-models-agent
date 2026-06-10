import { alexStyleProfile } from "@/content/style/alex-style-profile";
import type { CandidateState } from "@/domain/candidate";
import {
  ApprovedResponseSchema,
  ConversationFeedbackSchema,
  type AlexStyleRating,
  type ApprovedResponse,
  type ConversationFeedback,
  type ConversationFeedbackStatus
} from "@/domain/styleEvaluation";

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

  toSnapshot(): unknown {
    return {
      feedback: [...this.feedback.values()],
      approvedResponses: [...this.approvedResponses.values()]
    };
  }

  restoreSnapshot(data: unknown): void {
    if (!isSnapshotRecord(data)) {
      return;
    }

    if (Array.isArray(data.feedback)) {
      this.feedback.clear();
      for (const item of data.feedback) {
        const parsed = ConversationFeedbackSchema.safeParse(item);
        if (parsed.success) {
          this.feedback.set(parsed.data.id, parsed.data);
        }
      }
    }

    if (Array.isArray(data.approvedResponses)) {
      this.approvedResponses.clear();
      for (const item of data.approvedResponses) {
        const parsed = ApprovedResponseSchema.safeParse(item);
        if (parsed.success) {
          this.approvedResponses.set(parsed.data.id, parsed.data);
        }
      }
    }
  }
}

function isSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
