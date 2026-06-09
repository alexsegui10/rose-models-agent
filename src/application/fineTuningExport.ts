import type { ConversationExample } from "@/domain/conversationExample";

export interface FineTuningDataset {
  train: SanitizedFineTuningExample[];
  validation: SanitizedFineTuningExample[];
  evaluation: SanitizedFineTuningExample[];
}

export interface SanitizedFineTuningExample {
  id: string;
  category: string;
  messages: Array<{ role: "candidate" | "alex"; content: string }>;
  idealNextResponse?: string;
  tags: string[];
}

export function buildFutureFineTuningDataset(examples: ConversationExample[]): FineTuningDataset {
  const eligible = examples
    .filter((example) => example.approvedByAlex && example.sourceType === "ALEX_APPROVED")
    .filter((example) => !example.tags.includes("underage"))
    .map(sanitizeExample);

  return {
    train: eligible.filter((_, index) => index % 5 !== 0 && index % 5 !== 1),
    validation: eligible.filter((_, index) => index % 5 === 0),
    evaluation: eligible.filter((_, index) => index % 5 === 1)
  };
}

function sanitizeExample(example: ConversationExample): SanitizedFineTuningExample {
  return {
    id: example.id,
    category: example.category,
    messages: example.messages.map((message) => ({
      role: message.role,
      content: anonymize(message.content)
    })),
    idealNextResponse: example.idealNextResponse ? anonymize(example.idealNextResponse) : undefined,
    tags: example.tags
  };
}

function anonymize(value: string): string {
  return value
    .replace(/@\w+/g, "@candidate")
    .replace(/\b(?:\+34\s?)?(?:6|7|8|9)\d{2}[\s.-]?\d{3}[\s.-]?\d{3}\b/g, "ANON_PHONE")
    .replace(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g, "ANON_NAME");
}

