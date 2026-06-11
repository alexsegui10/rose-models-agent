// Reutiliza parseAnonymizedConversationJson de application/ a propósito: la validación de schema y
// la detección de PII deben ser EXACTAMENTE las mismas en todas las implementaciones del
// repositorio (mismo patrón que db/schema.ts, que ya importa los tipos de conversationImport).
import {
  ImportedConversationSchema,
  parseAnonymizedConversationJson,
  type ImportedConversation
} from "@/application/conversationImport";
import { asc, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { importedConversations } from "../db/schema";
import { warnInvalidRow } from "./postgresUtils";
import type { ImportedConversationRepository } from "./types";

type ImportedConversationRow = typeof importedConversations.$inferSelect;
type ImportedConversationInsert = typeof importedConversations.$inferInsert;

export class PostgresImportedConversationRepository implements ImportedConversationRepository {
  constructor(private readonly db: Database) {}

  async importJson(json: string): Promise<ImportedConversation[]> {
    const file = parseAnonymizedConversationJson(json);
    for (const conversation of file.conversations) {
      const row = conversationToRow(conversation);
      await this.db.insert(importedConversations).values(row).onConflictDoUpdate({ target: importedConversations.id, set: row });
    }
    return file.conversations;
  }

  async list(): Promise<ImportedConversation[]> {
    const rows = await this.db.select().from(importedConversations).orderBy(asc(importedConversations.id));
    return rows.map(rowToConversation).filter((item): item is ImportedConversation => item !== null);
  }

  async get(id: string): Promise<ImportedConversation | null> {
    const rows = await this.db.select().from(importedConversations).where(eq(importedConversations.id, id)).limit(1);
    return rows[0] ? rowToConversation(rows[0]) : null;
  }
}

function conversationToRow(conversation: ImportedConversation): ImportedConversationInsert {
  return {
    id: conversation.id,
    status: conversation.status,
    source: conversation.source,
    purpose: conversation.purpose,
    category: conversation.category,
    initialState: conversation.initialState,
    stateBefore: conversation.stateBefore,
    tags: conversation.tags,
    messages: conversation.messages,
    originalAlexResponses: conversation.originalAlexResponses,
    correctedResponses: conversation.correctedResponses,
    approved: conversation.approved,
    idealNextResponse: conversation.idealNextResponse ?? null,
    notes: conversation.notes ?? null,
    outcome: conversation.outcome ?? null,
    endedInCall: conversation.endedInCall ?? null,
    candidateApproved: conversation.candidateApproved ?? null,
    anonymizedPersonalData: conversation.anonymizedPersonalData
  };
}

function rowToConversation(row: ImportedConversationRow): ImportedConversation | null {
  // El documento jsonb de mensajes se rehidrata por el Zod del dominio; fila inválida → aviso y
  // se ignora, nunca lanza (lectura defensiva).
  const parsed = ImportedConversationSchema.safeParse({
    id: row.id,
    status: row.status,
    source: row.source,
    purpose: row.purpose,
    category: row.category,
    initialState: row.initialState,
    stateBefore: row.stateBefore,
    tags: row.tags,
    messages: row.messages,
    originalAlexResponses: row.originalAlexResponses,
    correctedResponses: row.correctedResponses,
    approved: row.approved,
    idealNextResponse: row.idealNextResponse ?? undefined,
    notes: row.notes ?? undefined,
    outcome: row.outcome ?? undefined,
    endedInCall: row.endedInCall ?? undefined,
    candidateApproved: row.candidateApproved ?? undefined,
    anonymizedPersonalData: row.anonymizedPersonalData
  });
  if (!parsed.success) {
    warnInvalidRow("imported_conversations", row.id, parsed.error);
    return null;
  }
  return parsed.data;
}
