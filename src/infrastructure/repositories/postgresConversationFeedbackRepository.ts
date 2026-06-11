import { asc, eq } from "drizzle-orm";
import {
  ApprovedResponseSchema,
  ConversationFeedbackSchema,
  type ApprovedResponse,
  type ConversationFeedback
} from "@/domain/styleEvaluation";
import type { Database } from "../db/client";
import { approvedResponses, conversationFeedback } from "../db/schema";
import { isUuid, warnInvalidRow } from "./postgresUtils";
import type { ConversationFeedbackRepository } from "./types";

type FeedbackRow = typeof conversationFeedback.$inferSelect;
type FeedbackInsert = typeof conversationFeedback.$inferInsert;
type ApprovedResponseRow = typeof approvedResponses.$inferSelect;
type ApprovedResponseInsert = typeof approvedResponses.$inferInsert;

export class PostgresConversationFeedbackRepository implements ConversationFeedbackRepository {
  constructor(private readonly db: Database) {}

  async saveFeedback(feedback: ConversationFeedback): Promise<ConversationFeedback> {
    // Validación Zod en el límite antes de escribir.
    const parsed = ConversationFeedbackSchema.parse(feedback);
    const row: FeedbackInsert = {
      id: parsed.id,
      candidateId: parsed.candidateId,
      messageId: parsed.messageId ?? null,
      status: parsed.status,
      originalResponse: parsed.originalResponse,
      editedResponse: parsed.editedResponse ?? null,
      reason: parsed.reason ?? null,
      styleRating: parsed.styleRating ?? null,
      state: parsed.state,
      contextSnapshot: parsed.contextSnapshot,
      styleProfileVersion: parsed.styleProfileVersion,
      promptVersion: parsed.promptVersion,
      modelVersion: parsed.modelVersion,
      createdAt: parsed.createdAt
    };
    await this.db.insert(conversationFeedback).values(row).onConflictDoUpdate({ target: conversationFeedback.id, set: row });
    return parsed;
  }

  async listFeedback(candidateId?: string): Promise<ConversationFeedback[]> {
    if (candidateId !== undefined && !isUuid(candidateId)) {
      return [];
    }

    const rows =
      candidateId === undefined
        ? await this.db.select().from(conversationFeedback).orderBy(asc(conversationFeedback.createdAt))
        : await this.db
            .select()
            .from(conversationFeedback)
            .where(eq(conversationFeedback.candidateId, candidateId))
            .orderBy(asc(conversationFeedback.createdAt));
    return rows.map(rowToFeedback).filter((item): item is ConversationFeedback => item !== null);
  }

  async saveApprovedResponse(response: ApprovedResponse): Promise<ApprovedResponse> {
    const parsed = ApprovedResponseSchema.parse(response);
    const row: ApprovedResponseInsert = {
      id: parsed.id,
      feedbackId: parsed.feedbackId,
      response: parsed.response,
      state: parsed.state,
      tags: parsed.tags,
      styleProfileVersion: parsed.styleProfileVersion,
      promptVersion: parsed.promptVersion,
      modelVersion: parsed.modelVersion,
      approvedAt: parsed.approvedAt
    };
    await this.db.insert(approvedResponses).values(row).onConflictDoUpdate({ target: approvedResponses.id, set: row });
    return parsed;
  }

  async listApprovedResponses(): Promise<ApprovedResponse[]> {
    const rows = await this.db.select().from(approvedResponses).orderBy(asc(approvedResponses.approvedAt));
    return rows.map(rowToApprovedResponse).filter((item): item is ApprovedResponse => item !== null);
  }
}

function rowToFeedback(row: FeedbackRow): ConversationFeedback | null {
  const parsed = ConversationFeedbackSchema.safeParse({
    id: row.id,
    candidateId: row.candidateId,
    messageId: row.messageId ?? undefined,
    status: row.status,
    originalResponse: row.originalResponse,
    editedResponse: row.editedResponse ?? undefined,
    reason: row.reason ?? undefined,
    styleRating: row.styleRating ?? undefined,
    state: row.state,
    contextSnapshot: row.contextSnapshot,
    createdAt: row.createdAt,
    styleProfileVersion: row.styleProfileVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion
  });
  if (!parsed.success) {
    warnInvalidRow("conversation_feedback", row.id, parsed.error);
    return null;
  }
  return parsed.data;
}

function rowToApprovedResponse(row: ApprovedResponseRow): ApprovedResponse | null {
  const parsed = ApprovedResponseSchema.safeParse({
    id: row.id,
    feedbackId: row.feedbackId,
    response: row.response,
    state: row.state,
    tags: row.tags,
    approvedAt: row.approvedAt,
    styleProfileVersion: row.styleProfileVersion,
    promptVersion: row.promptVersion,
    modelVersion: row.modelVersion
  });
  if (!parsed.success) {
    warnInvalidRow("approved_responses", row.id, parsed.error);
    return null;
  }
  return parsed.data;
}
