import { z } from "zod";
import { CandidateStateSchema, ConversationRoleSchema } from "@/domain/candidate";
import { ConversationExampleSchema, type ConversationExample } from "@/domain/conversationExample";
import type { ImportedConversationRepository } from "@/infrastructure/repositories/types";

export const ImportedConversationStatusSchema = z.enum(["RAW_REAL", "CORRECTED", "ALEX_APPROVED"]);
export type ImportedConversationStatus = z.infer<typeof ImportedConversationStatusSchema>;

export const ImportedConversationMessageSchema = z.object({
  role: ConversationRoleSchema,
  content: z.string().min(1),
  originalAlexResponse: z.string().optional(),
  correctedResponse: z.string().optional(),
  approved: z.boolean().default(false)
});

export const ImportedConversationSchema = z.object({
  id: z.string().min(1),
  status: ImportedConversationStatusSchema,
  source: z.literal("ANONYMIZED_JSON"),
  purpose: z.enum(["EXAMPLE", "EVALUATION"]),
  category: z.string().min(1).default("uncategorized"),
  initialState: CandidateStateSchema.default("NEW_LEAD"),
  stateBefore: CandidateStateSchema.default("NEW_LEAD"),
  tags: z.array(z.string()).default([]),
  messages: z.array(ImportedConversationMessageSchema).min(1),
  originalAlexResponses: z.array(z.string()).default([]),
  correctedResponses: z.array(z.string()).default([]),
  approved: z.boolean().default(false),
  idealNextResponse: z.string().optional(),
  notes: z.string().optional(),
  outcome: z.string().optional(),
  endedInCall: z.boolean().optional(),
  candidateApproved: z.boolean().optional(),
  anonymizedPersonalData: z.record(z.string()).default({})
});

export const ImportedConversationFileSchema = z.object({
  version: z.string().min(1),
  conversations: z.array(ImportedConversationSchema)
});

export type ImportedConversation = z.infer<typeof ImportedConversationSchema>;
export type ImportedConversationFile = z.infer<typeof ImportedConversationFileSchema>;

export class InMemoryImportedConversationRepository implements ImportedConversationRepository {
  private readonly conversations = new Map<string, ImportedConversation>();

  async importJson(json: string): Promise<ImportedConversation[]> {
    const file = parseAnonymizedConversationJson(json);
    for (const conversation of file.conversations) {
      this.conversations.set(conversation.id, conversation);
    }
    return file.conversations;
  }

  async list(): Promise<ImportedConversation[]> {
    return [...this.conversations.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<ImportedConversation | null> {
    return this.conversations.get(id) ?? null;
  }

  toSnapshot(): unknown {
    return {
      conversations: [...this.conversations.values()]
    };
  }

  restoreSnapshot(data: unknown): void {
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      return;
    }

    const conversations = (data as Record<string, unknown>).conversations;
    if (!Array.isArray(conversations)) {
      return;
    }

    this.conversations.clear();
    for (const item of conversations) {
      const parsed = ImportedConversationSchema.safeParse(item);
      if (parsed.success) {
        this.conversations.set(parsed.data.id, parsed.data);
      }
    }
  }
}

export function parseAnonymizedConversationJson(json: string): ImportedConversationFile {
  const parsed = ImportedConversationFileSchema.parse(JSON.parse(json));
  const piiFindings = parsed.conversations.flatMap((conversation) => detectPersonalData(conversation));

  if (piiFindings.length > 0) {
    throw new Error(`Imported conversations contain personal data: ${piiFindings.join("; ")}`);
  }

  return parsed;
}

export function approvedImportedConversationsForExamples(file: ImportedConversationFile): ConversationExample[] {
  return file.conversations
    .filter(
      (conversation) =>
        conversation.status === "ALEX_APPROVED" && conversation.purpose === "EXAMPLE" && conversation.idealNextResponse
    )
    .map((conversation) =>
      ConversationExampleSchema.parse({
        id: `imported-${conversation.id}`,
        category: "approved",
        sourceType: "ALEX_APPROVED",
        title: `Importado ${conversation.id}`,
        description: conversation.notes ?? "Conversacion real anonimizada aprobada por Alex.",
        candidateContext: {},
        stateBefore: conversation.stateBefore,
        intents: ["OTHER"],
        messages: conversation.messages,
        idealNextResponse: conversation.idealNextResponse,
        whyItIsGood: ["Aprobada por Alex desde conversacion anonimizada."],
        undesirablePatterns: [],
        tags: conversation.tags,
        approvedByAlex: true,
        qualityScore: 1,
        useForGeneration: true
      })
    );
}

export function importedConversationsForEvaluation(file: ImportedConversationFile): ImportedConversation[] {
  return file.conversations.filter((conversation) => conversation.purpose === "EVALUATION");
}

function detectPersonalData(conversation: ImportedConversation): string[] {
  const findings: string[] = [];
  const text = conversation.messages.map((message) => message.content).join("\n");

  if (/\b(?:\+?\d[\s.-]?){8,}\b/.test(text)) findings.push(`${conversation.id}: phone`);
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) findings.push(`${conversation.id}: email`);
  if (/(?:^|\s)@[a-z0-9._]{2,}/i.test(text)) findings.push(`${conversation.id}: social-handle`);

  return findings;
}
