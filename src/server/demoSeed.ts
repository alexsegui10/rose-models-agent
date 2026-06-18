import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { CallRecord, CandidateState, ConversationMessage, ConversationRole, HumanReviewReason } from "@/domain/candidate";
import type { CandidateRepository } from "@/infrastructure/repositories/types";

/**
 * Datos de DEMO para ver el CRM/Dashboard/Llamadas llenos (sin Instagram conectado). Idempotente:
 * usa ids fijos (`demo-XX`) -> re-sembrar sobreescribe, no duplica; los mensajes usan
 * `externalMessageId` fijo -> el repo los deduplica. NO toca candidatas reales (otros ids).
 * Es solo presentacion: no altera invariantes (los estados ya existen en la maquina de estados).
 */

interface DemoMessage {
  role: ConversationRole;
  content: string;
}

interface DemoSpec {
  id: string;
  username: string;
  firstName: string;
  state: CandidateState;
  minutesAgo: number;
  age?: number;
  city?: string;
  hasOnlyFans?: boolean;
  deviceModel?: string;
  interestLevel?: "LOW" | "MEDIUM" | "HIGH";
  objections?: string[];
  summary?: string;
  notes?: string[];
  slot?: string;
  reviewReason?: HumanReviewReason;
  lastCall?: CallRecord;
  messages?: DemoMessage[];
}

const SPECS: DemoSpec[] = [
  {
    id: "demo-01",
    username: "valentina_rm",
    firstName: "Valentina",
    state: "NEW_LEAD",
    minutesAgo: 4,
    age: 24,
    city: "Madrid",
    interestLevel: "MEDIUM",
    messages: [{ role: "candidate", content: "Hola! vi vuestro anuncio, me interesa saber como va 😊" }]
  },
  {
    id: "demo-02",
    username: "lucia.bcn",
    firstName: "Lucía",
    state: "WAITING_PROFILE_ACCESS",
    minutesAgo: 22,
    age: 27,
    city: "Barcelona",
    interestLevel: "MEDIUM"
  },
  {
    id: "demo-03",
    username: "carla_valencia",
    firstName: "Carla",
    state: "QUALIFYING",
    minutesAgo: 8,
    age: 22,
    city: "Valencia",
    hasOnlyFans: true,
    deviceModel: "iPhone 13",
    interestLevel: "HIGH",
    summary: "Tiene OnlyFans propio y quiere crecer. iPhone 13. Muy interesada.",
    messages: [
      { role: "candidate", content: "Hola, ya tengo OnlyFans pero no me crece mucho" },
      { role: "agent", content: "Genial Carla, justo en eso ayudamos. Cuentame, ¿con que movil grabas?" },
      { role: "candidate", content: "Un iPhone 13" }
    ]
  },
  {
    id: "demo-04",
    username: "sofia_dm",
    firstName: "Sofía",
    state: "PROFILE_READY_FOR_REVIEW",
    minutesAgo: 35,
    age: 29,
    city: "Sevilla",
    interestLevel: "HIGH",
    summary: "Perfil listo para que Alex valide si encaja."
  },
  {
    id: "demo-05",
    username: "marina.r",
    firstName: "Marina",
    state: "WAITING_HUMAN_REVIEW",
    minutesAgo: 12,
    age: 31,
    city: "Bilbao",
    interestLevel: "MEDIUM",
    reviewReason: "PERCENTAGE_NEGOTIATION",
    summary: "Pregunta por el reparto y quiere negociar el porcentaje.",
    messages: [{ role: "candidate", content: "¿y vosotros cuanto os quedais? me parece mucho la verdad" }]
  },
  {
    id: "demo-06",
    username: "daniela_xx",
    firstName: "Daniela",
    state: "HUMAN_INTERVENTION_REQUIRED",
    minutesAgo: 50,
    age: 28,
    reviewReason: "DATA_CONTRADICTION",
    summary: "Datos contradictorios: dijo dos edades distintas."
  },
  {
    id: "demo-07",
    username: "alba_md",
    firstName: "Alba",
    state: "APPROVED",
    minutesAgo: 90,
    age: 26,
    city: "Madrid",
    interestLevel: "HIGH",
    summary: "Aprobada por Alex. El bot propone la llamada."
  },
  {
    id: "demo-08",
    username: "noa.contenido",
    firstName: "Noa",
    state: "COLLECTING_CALL_DETAILS",
    minutesAgo: 18,
    age: 25,
    interestLevel: "HIGH"
  },
  {
    id: "demo-09",
    username: "irene_g",
    firstName: "Irene",
    state: "READY_TO_SCHEDULE",
    minutesAgo: 40,
    age: 30,
    city: "Zaragoza",
    interestLevel: "HIGH"
  },
  {
    id: "demo-10",
    username: "paula_rm",
    firstName: "Paula",
    state: "CALL_SCHEDULED",
    minutesAgo: 200,
    age: 23,
    city: "Madrid",
    interestLevel: "HIGH",
    slot: "el martes a las 18:00"
  },
  {
    id: "demo-11",
    username: "nerea_live",
    firstName: "Nerea",
    state: "CALL_IN_PROGRESS",
    minutesAgo: 1,
    age: 27,
    city: "Valencia",
    interestLevel: "HIGH",
    slot: "ahora"
  },
  {
    id: "demo-12",
    username: "claudia_of",
    firstName: "Claudia",
    state: "CALL_COMPLETED",
    minutesAgo: 300,
    age: 26,
    city: "Málaga",
    hasOnlyFans: true,
    interestLevel: "HIGH",
    summary: "Llamada hecha: negociamos al 65%, le paso el contrato.",
    lastCall: {
      result: "COMPLETED",
      durationSec: 327,
      negotiatedModelShare: 65,
      summary: "Explicada la agencia. Se quejó del reparto, bajamos a 65%. Acepta. Le paso el contrato.",
      transcript: [
        { role: "agent", content: "Hola Claudia, te llamo de Rose Models, ¿te pillo bien?" },
        { role: "candidate", content: "Si si, dime" },
        { role: "agent", content: "Te cuento como trabajamos y resolvemos dudas. Nosotros llevamos todo el chat y la promo." },
        { role: "candidate", content: "Vale pero el 30% se me hace mucho" },
        { role: "agent", content: "Te entiendo. En tu caso lo podemos dejar en un 65% para ti." },
        { role: "candidate", content: "Asi si, me parece bien" },
        { role: "agent", content: "Perfecto, te paso ahora el contrato y cualquier duda me dices." }
      ],
      endedAt: new Date(Date.now() - 300 * 60000).toISOString()
    }
  },
  {
    id: "demo-13",
    username: "elena_nc",
    firstName: "Elena",
    state: "CALL_NO_ANSWER",
    minutesAgo: 1440,
    age: 24,
    city: "Murcia",
    interestLevel: "MEDIUM",
    slot: "el lunes a las 17:00",
    lastCall: {
      result: "NO_ANSWER",
      summary: "No contestó. Pendiente de reagendar.",
      transcript: [],
      endedAt: new Date(Date.now() - 1440 * 60000).toISOString()
    }
  },
  {
    id: "demo-14",
    username: "rocio_x",
    firstName: "Rocío",
    state: "REJECTED",
    minutesAgo: 2880,
    age: 33,
    interestLevel: "LOW",
    notes: ["Rechazada por Alex: no encaja con el perfil."]
  },
  {
    id: "demo-15",
    username: "cerrada_demo",
    firstName: "Andrea",
    state: "CLOSED",
    minutesAgo: 4320,
    interestLevel: "LOW",
    notes: ["Cerrada."]
  }
];

function authorFor(role: ConversationRole): "CANDIDATE" | "AI_AGENT" | "ALEX" | "SYSTEM" {
  if (role === "candidate") return "CANDIDATE";
  if (role === "agent") return "AI_AGENT";
  if (role === "alex") return "ALEX";
  return "SYSTEM";
}

// IDs de demo: UUIDs VÁLIDOS con prefijo reconocible (la BD usa columnas uuid; un "demo-01" la
// rompería y, además, findCandidateById/listMessages descartan ids no-uuid). El prefijo permite
// localizarlas y borrarlas en bloque sin tocar candidatas reales.
export const DEMO_ID_PREFIX = "00000000-0000-4000-8000-";
const demoCandidateId = (n: number): string => `${DEMO_ID_PREFIX}${String(n).padStart(12, "0")}`;
const demoMessageId = (n: number, msgIndex: number): string =>
  `00000000-0000-4000-8001-${String(n * 100 + msgIndex).padStart(12, "0")}`;
const specNumber = (specId: string): number => Number(specId.replace("demo-", ""));

export async function seedDemoCandidates(repository: CandidateRepository): Promise<number> {
  const now = Date.now();
  const at = (minutesAgo: number): Date => new Date(now - minutesAgo * 60000);

  for (const spec of SPECS) {
    const num = specNumber(spec.id);
    const candidateId = demoCandidateId(num);
    const base = createCandidate({ instagramUsername: spec.username, displayName: spec.firstName });
    const candidate = normalizeCandidate({
      ...base,
      id: candidateId,
      firstName: spec.firstName,
      currentState: spec.state,
      age: spec.age,
      city: spec.city,
      country: spec.city ? "España" : undefined,
      hasOnlyFans: spec.hasOnlyFans,
      deviceModel: spec.deviceModel ?? null,
      interestLevel: spec.interestLevel ?? "UNKNOWN",
      objections: spec.objections ?? [],
      conversationSummary: spec.summary ?? "",
      notes: spec.notes ?? [],
      scheduledCallSlot: spec.slot,
      humanReviewReason: spec.reviewReason,
      lastCall: spec.lastCall,
      createdAt: at(spec.minutesAgo + 180),
      updatedAt: at(spec.minutesAgo),
      lastMessageAt: at(spec.minutesAgo)
    });
    await repository.saveCandidate(candidate);

    const messages = spec.messages ?? [];
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const stored: ConversationMessage = {
        id: demoMessageId(num, index + 1),
        candidateId,
        role: message.role,
        author: authorFor(message.role),
        content: message.content,
        externalMessageId: `demo-msg-${num}-${index + 1}`,
        createdAt: at(spec.minutesAgo + (messages.length - index) * 3)
      };
      await repository.addMessage(stored);
    }
  }

  return SPECS.length;
}

// Borra TODAS las candidatas de demo (las que tienen el prefijo de id de demo). No toca reales.
export async function clearDemoCandidates(repository: CandidateRepository): Promise<number> {
  const all = await repository.listCandidates();
  const demo = all.filter((candidate) => candidate.id.startsWith(DEMO_ID_PREFIX));
  for (const candidate of demo) {
    await repository.deleteCandidate(candidate.id);
  }
  return demo.length;
}
