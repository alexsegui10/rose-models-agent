import { z } from "zod";
import { ConversationRoleSchema } from "@/domain/candidate";
import { ConversationExampleSchema, type ConversationExample } from "@/domain/conversationExample";

export const ImportedConversationStatusSchema = z.enum(["RAW_REAL", "CORRECTED", "ALEX_APPROVED"]);
export type ImportedConversationStatus = z.infer<typeof ImportedConversationStatusSchema>;

export const ImportedConversationMessageSchema = z.object({
  role: ConversationRoleSchema,
  content: z.string().min(1)
});

export const ImportedConversationSchema = z.object({
  id: z.string().min(1),
  status: ImportedConversationStatusSchema,
  source: z.literal("ANONYMIZED_JSON"),
  purpose: z.enum(["EXAMPLE", "EVALUATION"]),
  stateBefore: z.string().min(1),
  tags: z.array(z.string()).default([]),
  messages: z.array(ImportedConversationMessageSchema).min(1),
  idealNextResponse: z.string().optional(),
  notes: z.string().optional()
});

export const ImportedConversationFileSchema = z.object({
  version: z.string().min(1),
  conversations: z.array(ImportedConversationSchema)
});

export type ImportedConversation = z.infer<typeof ImportedConversationSchema>;
export type ImportedConversationFile = z.infer<typeof ImportedConversationFileSchema>;

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
    .filter((conversation) => conversation.status === "ALEX_APPROVED" && conversation.purpose === "EXAMPLE" && conversation.idealNextResponse)
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
