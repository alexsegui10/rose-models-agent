import { businessKnowledgeEntries } from "@/content/business";
import type { Candidate } from "@/domain/candidate";
import type { KnowledgeCategory, KnowledgeEntry } from "@/domain/businessKnowledge";
import type { ConversationIntent } from "./llmProvider";

export interface BusinessKnowledgeRetrievalInput {
  candidate: Candidate;
  intent: ConversationIntent;
  question: string;
  categories?: KnowledgeCategory[];
  includeDrafts?: boolean;
  limit?: number;
}

export interface BusinessKnowledgeRetriever {
  retrieve(input: BusinessKnowledgeRetrievalInput): Promise<KnowledgeEntry[]>;
}

export class LocalBusinessKnowledgeRetriever implements BusinessKnowledgeRetriever {
  constructor(private readonly entries: KnowledgeEntry[] = businessKnowledgeEntries) {}

  async retrieve(input: BusinessKnowledgeRetrievalInput): Promise<KnowledgeEntry[]> {
    const limit = input.limit ?? 5;
    const scored = this.entries
      .filter((entry) => isUsableEntry(entry, input))
      .map((entry) => ({ entry, score: scoreEntry(entry, input) }))
      .filter((item) => item.score >= 1)
      .sort((a, b) => b.score - a.score);

    const selected: KnowledgeEntry[] = [];
    const seen = new Set<string>();

    for (const item of scored) {
      if (seen.has(item.entry.id)) {
        continue;
      }

      seen.add(item.entry.id);
      selected.push(item.entry);

      if (selected.length >= Math.min(Math.max(limit, 2), 6)) {
        break;
      }
    }

    return selected;
  }
}

function isUsableEntry(entry: KnowledgeEntry, input: BusinessKnowledgeRetrievalInput): boolean {
  if (!input.includeDrafts && (entry.status !== "ACTIVE" || !entry.approvedByAlex)) {
    return false;
  }

  if (input.categories?.length && !input.categories.includes(entry.category)) {
    return false;
  }

  const tags = tagsFromInput(input);
  if (entry.tags.includes("sensitive") && !tags.includes("sensitive")) {
    return false;
  }

  return entry.allowedStates.length === 0 || entry.allowedStates.includes(input.candidate.currentState);
}

function scoreEntry(entry: KnowledgeEntry, input: BusinessKnowledgeRetrievalInput): number {
  let score = 0;
  const message = normalize(input.question);
  const tags = tagsFromInput(input);

  for (const tag of tags) {
    if (entry.tags.includes(tag)) score += 1.4;
  }

  for (const fact of [...entry.facts, ...entry.approvedAnswerPoints, entry.title]) {
    for (const word of normalize(fact).split(/\s+/)) {
      if (word.length > 4 && message.includes(word)) {
        score += 0.12;
      }
    }
  }

  return score;
}

function tagsFromInput(input: BusinessKnowledgeRetrievalInput): string[] {
  const message = normalize(input.question);
  const tags: string[] = [];

  if (/\b(sueldo|salario|fijo|paga|cobro|cobrar)\b/.test(message)) tags.push("salary", "payment", "commercial");
  if (/\b(porcentaje|comision|comisión|reparto|cuanto os quedais|cuánto os quedáis)\b/.test(message)) {
    tags.push("percentage", "revenue-share", "commercial");
  }
  if (/\b(70\/30|quien recibe|quién recibe|quien se queda|quién se queda)\b/.test(message)) {
    tags.push("percentage-split", "revenue-share", "sensitive");
  }
  if (/\b(me dais|dame|negociar|negociamos|excepcion|excepción)\b/.test(message) || /\b\d{1,3}\s?%/.test(message)) {
    tags.push("percentage", "revenue-share", "sensitive", "negotiation");
  }
  if (/\b(que haceis|qué hacéis|que hace la agencia|servicios|trafico|tráfico|estrategia|monetizacion|monetización)\b/.test(message)) {
    tags.push("services", "agency", "strategy", "traffic", "monetization");
  }
  if (/\b(que hago yo|qué hago yo|mi parte|modelo|contenido|crear contenido|enviar contenido)\b/.test(message)) {
    tags.push("model-responsibilities", "content");
  }
  if (/\b(llamada|llamar|telefono|teléfono|whatsapp)\b/.test(message)) tags.push("call", "schedule");
  if (/\b(contrato|legal|clausula|cláusula|permanencia)\b/.test(message)) tags.push("contract", "legal", "human-review");
  if (/\b(como funciona|cómo funciona|proceso|que pasos|qué pasos)\b/.test(message)) tags.push("faq", "process", "how-it-works");
  if (/\b(desconfianza|duda|no me fio|no me fío|raro)\b/.test(message)) tags.push("distrust", "objection");
  if (/\b(iphone|i phone|android|movil|móvil|telefono necesito|teléfono necesito)\b/.test(message)) tags.push("iphone", "device", "requirement");

  if (input.intent === "ASKS_ABOUT_PERCENTAGE") tags.push("percentage", "revenue-share");
  if (input.intent === "ASKS_ABOUT_CONTRACT") tags.push("contract", "legal", "human-review");
  if (input.intent === "REQUESTS_CALL") tags.push("call", "schedule");

  return tags;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFC");
}
