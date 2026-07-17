import type { Candidate } from "@/domain/candidate";
import type { ConversationExample } from "@/domain/conversationExample";
import type { ConversationIntent } from "./llmProvider";
import { conversationExamples } from "@/content/examples/conversationExamples";

export interface ExampleRetrievalInput {
  candidate: Candidate;
  intent: ConversationIntent;
  inboundMessage: string;
  tags?: string[];
  includeUnapproved?: boolean;
  limit?: number;
}

export interface ExampleRetriever {
  retrieve(input: ExampleRetrievalInput): Promise<ConversationExample[]>;
}

export class LocalExampleRetriever implements ExampleRetriever {
  constructor(private readonly examples: ConversationExample[] = conversationExamples) {}

  async retrieve(input: ExampleRetrievalInput): Promise<ConversationExample[]> {
    const limit = input.limit ?? 5;
    const scored = this.examples
      .filter((example) => isUsableExample(example, input.includeUnapproved))
      .filter((example) => !derivesHerCallToPartner(example, input))
      .map((example) => ({ example, score: scoreExample(example, input) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const seen = new Set<string>();
    const selected: ConversationExample[] = [];

    for (const item of scored) {
      if (seen.has(item.example.id)) {
        continue;
      }

      seen.add(item.example.id);
      selected.push(item.example);

      if (selected.length >= Math.min(Math.max(limit, 3), 6)) {
        break;
      }
    }

    return selected;
  }
}

function isUsableExample(example: ConversationExample, includeUnapproved?: boolean): boolean {
  if (!example.useForGeneration || example.sourceType === "EVALUATION_ONLY") {
    return false;
  }

  return includeUnapproved
    ? example.qualityScore !== undefined && example.qualityScore >= 0.7
    : example.approvedByAlex && example.qualityScore !== undefined && example.qualityScore >= 0.8;
}

/**
 * 17-jul (2a prueba real de Alex, caso "Laura"): con el Encaja YA dado, el redactor soltaba "Lo apunto. Lo
 * hablo con mi socio y te digo para la llamada" — y NO se lo inventaba: copiaba LITERAL el ejemplo
 * `example-real-provides-phone-early-1`, cuya respuesta ideal es justo esa. Ese ejemplo es de QUALIFYING (sin
 * aprobar), pero el recuperador lo servia igual a una aprobada porque casa el intent PROVIDES_PHONE (+1.6).
 *
 * Con el Encaja dado no queda nada pendiente que consultar sobre ella, asi que un ejemplo que derive SU
 * llamada al socio no se le ofrece: no puede copiar lo que no ve. Es mas fiable que anadir otra instruccion
 * al prompt (que ya ronda los 9k tokens y se las traga). Solo se filtra ese sentido: los ejemplos que derivan
 * una DUDA concreta al socio siguen sirviendo.
 */
function derivesHerCallToPartner(example: ConversationExample, input: ExampleRetrievalInput): boolean {
  if (input.candidate.humanFitDecision !== "APPROVED") return false;
  return /con mi socio[^.!?]{0,30}(?:para (?:la llamada|agendar)|y te digo para)|comentar tu perfil con mi socio/i.test(
    example.idealNextResponse ?? ""
  );
}

function scoreExample(example: ConversationExample, input: ExampleRetrievalInput): number {
  let score = example.qualityScore ?? 0;
  const normalizedMessage = normalize(input.inboundMessage);
  const requestedTags = new Set([...(input.tags ?? []), ...tagsFromInput(input)]);

  if (example.stateBefore === input.candidate.currentState) {
    score += 1.8;
  }

  if (example.intents.includes(input.intent)) {
    score += 1.6;
  }

  for (const tag of requestedTags) {
    if (example.tags.includes(tag)) {
      score += 0.7;
    }
  }

  for (const message of example.messages) {
    const words = normalize(message.content)
      .split(/\s+/)
      .filter((word) => word.length > 3);
    for (const word of words) {
      if (normalizedMessage.includes(word)) {
        score += 0.08;
      }
    }
  }

  if (example.category === "private-profile" && input.candidate.declaredProfileVisibility !== "PRIVATE") {
    score -= 1.2;
  }

  if (example.category === "rejected" && input.candidate.currentState !== "REJECTED") {
    score -= 1.5;
  }

  return score;
}

function tagsFromInput(input: ExampleRetrievalInput): string[] {
  const tags: string[] = [];
  const message = normalize(input.inboundMessage);

  if (input.candidate.declaredProfileVisibility === "PRIVATE") tags.push("private-profile");
  if (input.candidate.declaredProfileVisibility === "PUBLIC") tags.push("public-profile");
  if (input.candidate.phone || /\b\d{3}[\s.-]?\d{3}[\s.-]?\d{3}\b/.test(message)) tags.push("phone");
  if (/\b(llamada|llamar|telefono|telefono|whatsapp)\b/.test(message)) tags.push("call");
  if (/\b(porcentaje|comision|comisión)\b/.test(message)) tags.push("percentage", "sensitive");
  if (input.candidate.worksWithAnotherAgency || /\b(otra agencia|agencia actual)\b/.test(message)) tags.push("agency");
  if (input.candidate.currentState === "WAITING_HUMAN_REVIEW") tags.push("human-review");

  return tags;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFC");
}
