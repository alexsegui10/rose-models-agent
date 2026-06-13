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
      if (seen.has(item.entry.id)) continue;
      seen.add(item.entry.id);
      selected.push(item.entry);
      if (selected.length >= Math.min(Math.max(limit, 2), 6)) break;
    }

    return selected;
  }
}

function isUsableEntry(entry: KnowledgeEntry, input: BusinessKnowledgeRetrievalInput): boolean {
  if (!input.includeDrafts && (entry.status !== "ACTIVE" || !entry.approvedByAlex)) return false;
  if (input.categories?.length && !input.categories.includes(entry.category)) return false;

  const tags = tagsFromInput(input);
  if (entry.tags.includes("sensitive") && !tags.includes("sensitive")) return false;

  // En HUMAN_INTERVENTION_REQUIRED el estado pausa DECISIONES, no respuestas documentadas (fallo
  // real: bucle "lo hablo con mi socio"), pero SIN saltarse el gating de estados: solo son
  // respondibles las entradas con allowedStates vacio o que incluyan HUMAN_INTERVENTION_REQUIRED.
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
      if (word.length > 4 && message.includes(word)) score += 0.12;
    }
  }

  return score;
}

function tagsFromInput(input: BusinessKnowledgeRetrievalInput): string[] {
  const message = normalize(input.question);
  const tags: string[] = [];

  if (/\b(sueldo|salario|fijo|paga|pagan|pagais|pagos|cobro|cobrar|cobraria|ganaria|cuanto se gana|cuanto gano)\b/.test(message))
    tags.push("salary", "payment", "commercial");
  if (/\b(porcentaje|comision|reparto|cuanto os quedais)\b/.test(message)) tags.push("percentage", "revenue-share", "commercial");
  if (/\b(70\/30|quien recibe|quien se queda)\b/.test(message)) tags.push("percentage", "revenue-share");
  if (/\b(por que.*70|porque.*70|porcentaje.*alto|os quedais.*70)\b/.test(message)) tags.push("why-70", "percentage", "services");
  if (/\b(skrill|liquidacion|cada 14|14 dias|neto|comision de la plataforma)\b/.test(message))
    tags.push("settlement", "skrill", "payment", "revenue-share");
  if (/\b(me dais|dame|negociar|negociamos|excepcion)\b/.test(message) || /\b\d{1,3}\s?%/.test(message))
    tags.push("percentage", "revenue-share", "sensitive", "negotiation");
  if (/\b(que haceis|que hace la agencia|servicios|trafico|estrategia|monetizacion)\b/.test(message))
    tags.push("services", "agency", "strategy", "traffic", "monetization");
  // El pitch operativo ("cual es su forma de trabajar?", "como me promocionan?") es la pregunta
  // mas matadora de leads cuando se deriva al socio: debe recuperar SIEMPRE la entrada de servicios.
  if (
    /\bcomo trabaj|\bcomo se trabaja\b|\bforma de trabajar\b|\ben que consiste\b|\bque (?:me )?ofrec|\bcomo (?:me |la )?promocion|\bcomo (?:lo|la|se) manej|\bme la gestionen\b|\bcomo seria el trabajo\b/.test(
      message
    )
  )
    tags.push("services", "agency", "strategy");
  // "Podrian explicarme todo por mensaje?" / "No quiero llamadas, me lo explicas por aqui?": tiene
  // rama documentada (r12) y debe entregar el pitch operativo, no derivar al socio (iteracion 3).
  if (
    /\bexplic\w*\b[^.!?]{0,30}\b(?:por (?:aqui|mensaje|chat|escrito)|solo x mensaje|x mensaje|por dm|por instagram)\b/.test(
      message
    ) ||
    /\bno quiero llamadas?\b/.test(message)
  )
    tags.push("services", "agency", "strategy");
  if (/\b(que hago yo|mi parte|modelo|contenido|crear contenido|enviar contenido|drive)\b/.test(message))
    tags.push("model-responsibilities", "content");
  if (/\b(reels|fotos|dias iniciales|cuantas fotos|cuantos reels)\b/.test(message))
    tags.push("production", "reels", "photos", "warmup");
  if (
    /\b(publicado antes|publicar antes|nuevo|material antiguo|contenido antiguo|ya creado|reutilizar|sexting|viejos videos)\b/.test(
      message
    )
  ) {
    tags.push("old-material", "new-content", "onlyfans", "instagram");
  }
  if (/\b(limites|no quiero hacer|contenido anal|desnudo|juguetes)\b/.test(message)) tags.push("boundaries", "limits", "content");
  if (/\b(llamada|llamar|telefono|whatsapp)\b/.test(message)) tags.push("call", "schedule");
  if (/\b(grabar|grabacion|transcribir|transcripcion|retell)\b/.test(message))
    tags.push("retell", "recording", "transcript", "consent");
  if (/\b(contrato|legal|clausula|permanencia)\b/.test(message)) tags.push("contract", "legal", "human-review");
  if (/\b(preaviso|finalizar|terminar|contenido autorizado|dejar la agencia)\b/.test(message))
    tags.push("termination", "content-rights", "legal-review");
  if (/\b(como funciona|proceso|que pasos)\b/.test(message)) tags.push("faq", "process", "how-it-works");
  if (/\b(desconfianza|duda|no me fio|raro|estafa|enfadada|enfado)\b/.test(message))
    tags.push("distrust", "objection", "human-intervention", "scam", "anger");
  // Sin "requirement": esa etiqueta tambien marca la politica de cara y provocaba volcadas de
  // conocimiento no pedidas (sermon de la cara ante "tengo iPhone 14 Pro").
  if (/\b(iphone|i phone|android|movil|telefono necesito|samsung|galaxy|s23|s24|s25)\b/.test(message))
    tags.push("iphone", "galaxy", "device", "quality");
  if (/\b(ia|inteligencia artificial|bot|asistente virtual)\b/.test(message)) tags.push("ai", "identity", "transparency");
  if (/\b(no responde|seguimiento|volver a escribir|insistir)\b/.test(message)) tags.push("follow-up", "decline", "limited");
  if (/\b(lanzamiento|lanzar|lanzais|cuando empiezo|cuando se lanza|cuanto tarda|30 dias|semanas)\b/.test(message))
    tags.push("launch", "timeline", "warmup");
  if (/\b(paises|que pais|vendeis|venden|mercado|compradores|poder adquisitivo)\b/.test(message))
    tags.push("countries", "market", "faq");
  if (/\b(seleccion|requisitos para entrar|como entro|que buscais)\b/.test(message)) tags.push("selection", "process", "faq");
  if (
    /\b(bloquear|bloqueo|bloqueen|que no me vean|me reconozcan|me vea alguien|privacidad|anonimato|mi pais|conocidos)\b/.test(
      message
    )
  )
    tags.push("geo-privacy", "privacy", "country-block", "objection");
  if (/\b(cara|rostro|anonima|sin mostrarme|sin ensenarme)\b/.test(message)) tags.push("face", "anonymity", "requirement");
  // Solo si la mencion no es negada: "no trabajo con otra agencia" es un dato, no una objecion.
  if (
    /\b(otra agencia|otras agencias|dos agencias|multi ?agencia|otra empresa)\b/.test(message) &&
    !/\b(?:no|nunca|jamas)\b[^.!?]{0,30}\bagencias?\b/.test(message)
  )
    tags.push("multi-agency", "agencies", "market-conflict");
  if (/\b(no uso instagram|no tengo instagram|no subo fotos|no uso redes)\b/.test(message))
    tags.push("agency-responsibilities", "instagram", "operations");
  if (/\b(pruebas|demostrar|demuestren|demuestra|resultados de otras|otras modelos|garantias)\b/.test(message))
    tags.push("distrust", "objection");
  if (/\b(telegram|twitter|videollamadas|otras redes)\b/.test(message)) tags.push("traffic", "telegram", "twitter", "services");

  if (input.intent === "ASKS_ABOUT_PERCENTAGE") tags.push("percentage", "revenue-share");
  if (input.intent === "ASKS_ABOUT_CONTRACT") tags.push("contract", "legal", "human-review");
  if (input.intent === "REQUESTS_CALL") tags.push("call", "schedule");

  return tags;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
