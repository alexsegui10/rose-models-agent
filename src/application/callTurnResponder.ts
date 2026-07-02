/**
 * Responde un turno de la llamada a partir del historial de mensajes estilo OpenAI (lo que envía el
 * "Custom LLM" de la plataforma de voz en cada turno).
 *
 * Es STATELESS: reconstruye el estado del director RE-REPRODUCIENDO los turnos de la candidata (la
 * clasificación es determinista y las señales que NO cambian estado —preguntas, desconfianza— no
 * afectan a la reproducción), así no necesita almacén entre invocaciones (ideal en serverless).
 *
 * Redacción: NATURAL por defecto (jul-2026) — si hay drafter (OPENAI_API_KEY), redacta los turnos con
 * brief (validador de voz + fallback determinista SIEMPRE detrás); sin drafter, guion determinista puro.
 * Las preguntas CUBIERTAS por el conocimiento aprobado se responden (decisión de Alex 17-jun); las NO
 * cubiertas se defieren ("te lo confirmo por WhatsApp"). El recuperador solo se consulta para el ÚLTIMO
 * turno (el del directivo en vivo): el replay no lo necesita porque asks-covered/asks-unknown no cambian
 * el estado del director.
 */

import { businessKnowledgeEntries } from "@/content/business";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { runCallTurn, type CallTurnResult } from "./callBrain";
import type { CallContext } from "./callContext";
import type { CallUtteranceDrafter } from "./callDrafter";
import { extractCallFacts } from "./callFactExtractor";
import { decideCallDirective, initialCallDirectorState, type CallDirectiveType, type CallDirectorState } from "./callDirector";
import { validateCallUtterance } from "./callRedactionValidator";
import { classifyCallSignal } from "./callSignalClassifier";
import { LocalBusinessKnowledgeRetriever, type BusinessKnowledgeRetriever } from "./businessKnowledgeRetriever";

export interface CallChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface RespondToCallInput {
  messages: CallChatMessage[];
  candidateName?: string;
  recorded?: boolean;
  /** Contexto de la candidata (del DM): el disparador de la llamada lo construye y lo pasa por metadata. */
  context?: CallContext;
  /** Recuperador de conocimiento (inyectable para tests); por defecto el local sobre el contenido. */
  retriever?: BusinessKnowledgeRetriever;
  /** Si false, NO responde preguntas con el conocimiento (las defiere todas). Por defecto true. */
  answerFromKnowledge?: boolean;
  /** Redactor de voz (LLM) opcional. Si se inyecta, redacta las etapas explicativas (con validación +
   *  fallback); si no, se usa el guion determinista. Lo conecta el endpoint cuando hay clave/config. */
  drafter?: CallUtteranceDrafter;
  /**
   * "Buffer words" (jul-2026): se invoca JUSTO ANTES de llamar al redactor LLM (la única parte lenta)
   * con una muletilla corta ("Vale... ") para que el endpoint la emita ya en streaming y el silencio
   * previo a la respuesta se tape como lo taparía una persona. En los caminos deterministas no se llama
   * (son instantáneos). El texto devuelto por respondToCall NO incluye la muletilla.
   */
  onDraftStart?: (bufferText: string) => void;
}

export interface CallResponderResult {
  /** Lo que debe decir el bot en este turno. */
  content: string;
  signal: CallTurnResult["signal"];
  directiveType: CallTurnResult["directive"]["type"];
}

// Candidata sintética para consultar el conocimiento durante la llamada (estado de llamada en curso).
// La recuperación usa `ignoreStateGating` (la candidata ya está cualificada): se responde cualquier hecho
// aprobado y NO sensible; el % y los DRAFT siguen sin salir por aquí.
const callKnowledgeCandidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "call_context" }),
  currentState: "CALL_IN_PROGRESS"
});

const defaultRetriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);

// Muletilla por directiva para tapar la latencia del redactor (elegida para no chocar con los arranques
// típicos del fallback de cada directiva). La elipsis + espacio final es el formato que la plataforma de
// voz pronuncia con pausa natural sin distorsión.
const DRAFT_BUFFER_WORDS: Partial<Record<CallDirectiveType, string>> = {
  COVER_STAGE: "Vale... ",
  ANSWER_FROM_KNOWLEDGE: "A ver... ",
  REASSURE: "Ya... ",
  DEFER_TO_PARTNER: "Pues... ",
  GIVE_IDENTITY: "Eh... "
};

export async function respondToCall(input: RespondToCallInput): Promise<CallResponderResult> {
  const userUtterances = input.messages.filter((m) => m.role === "user").map((m) => m.content ?? "");

  // La apertura legal se considera dada SOLO si el BOT ya habló (mensaje assistant no vacío). NO se infiere
  // de que la candidata haya hablado: si ella habla primero, el bot debe abrir igualmente con la locución
  // legal (no perderla nunca; riesgo EU AI Act / RGPD).
  const botHasSpoken = input.messages.some((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0);

  // Interruptor de la apertura legal. Por defecto ACTIVA (es obligatoria por ley antes de una llamada
  // real). CALL_DISCLOSURE=off la desactiva SOLO para pruebas; debe volver a ON antes de producción.
  const disclosureEnabled = process.env.CALL_DISCLOSURE !== "off";

  let state: CallDirectorState = initialCallDirectorState();
  if (!disclosureEnabled) {
    state = { ...state, disclosureGiven: true };
  }
  let lastUtterance = "";

  if (botHasSpoken) {
    // Consume el primer turno del bot (la apertura legal si está activa, o la 1ª etapa si no) y reproduce
    // los turnos previos de la candidata para reconstruir el estado. La señal "none" produce lo correcto
    // en ambos casos (apertura si disclosureGiven=false; avanzar agenda si ya está dada).
    state = decideCallDirective({ state, signal: "none" }).nextState;
    for (let i = 0; i < userUtterances.length - 1; i++) {
      const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
      const signal = classifyCallSignal({ utterance: userUtterances[i], moneyContext });
      state = decideCallDirective({ state, signal }).nextState;
    }
    lastUtterance = userUtterances[userUtterances.length - 1] ?? "";
  }

  // Conocimiento que cubre la pregunta del turno EN VIVO (solo si responder está activo y hay texto).
  const coveringEntries =
    input.answerFromKnowledge !== false && lastUtterance.trim().length > 0
      ? await resolveCoveringEntries(lastUtterance, input.retriever ?? defaultRetriever)
      : [];

  // ANTI-LORO tras el final (jul-2026, llamada real de Alex: 8 MINUTOS repitiendo "te paso con mi socio"
  // cada 15s al ASR mandando "..."): con la llamada YA transferida o cerrada ANTES de este turno, un turno
  // de ruido/silencio no repite el cierre — se calla (""). El colgado real lo pone ElevenLabs (timeout de
  // silencio del agente); esto evita quemar minutos hablando solo. Si dice algo REAL tras el cierre, el
  // director sigue decidiendo (repetir el cierre una vez / escalar por seguridad) como siempre.
  const terminalBeforeTurn = state.handedOff || state.closed;
  const lastUtteranceIsNoise = lastUtterance.trim().length === 0 || /^[\s.·…,;:!?-]*$/.test(lastUtterance);
  if (botHasSpoken && terminalBeforeTurn && lastUtteranceIsNoise) {
    console.log("[call-turn]", JSON.stringify({ signal: "noise-after-terminal", directive: "SILENCE", usedDrafter: false }));
    return { content: "", signal: "unclear", directiveType: state.handedOff ? "HANDOFF_TO_ALEX" : "CLOSE_WITH_CONTRACT" };
  }

  const result = runCallTurn({
    state,
    utterance: lastUtterance,
    candidateName: input.candidateName ?? input.context?.candidateName,
    recorded: input.recorded,
    context: input.context,
    // En el turno de apertura (el bot aún no habló) el bot INICIA: señal "none" (no "unclear" por vacío).
    signal: botHasSpoken ? undefined : "none",
    resolveQuestion: () => coveringEntries,
    // Memoria de la llamada (jul-2026): lo que ELLA ya dijo en cualquier turno (extractor determinista),
    // para que el redactor no re-pregunte y pueda referenciarlo. No decide nada (solo informa).
    callFacts: extractCallFacts(userUtterances)
  });

  const plan = result.utterancePlan;
  let content: string;
  let usedDrafter = false;
  if (plan.deterministicText) {
    // Crítico/guion (apertura, cifra del reparto, handoff, cierre): NUNCA pasa por el LLM.
    content = plan.deterministicText;
  } else if (plan.draftingBrief && input.drafter) {
    // Buffer words: avisar al endpoint ANTES de la única espera lenta (el LLM), para que la voz ya esté
    // diciendo algo ("Vale... ") mientras se redacta. Sin drafter no hay espera y no se emite nada.
    input.onDraftStart?.(DRAFT_BUFFER_WORDS[result.directive.type] ?? "Eh... ");
    // Redacción natural por LLM, SOLO si pasa el validador de voz; si no, fallback determinista (inv. 6).
    const draft = await input.drafter.draft({
      brief: plan.draftingBrief,
      context: input.context,
      directiveType: result.directive.type
    });
    // Cifras del reparto SOLO en el turno de dinero (endurecimiento R1 jul-2026): en cualquier otro turno
    // redactado, un porcentaje —aunque sea el autorizado— está fuera de sitio y tira el draft al fallback.
    const allowShare = result.directive.type === "COVER_STAGE" && result.directive.stageId === "MONEY";
    if (draft && validateCallUtterance(draft, plan.draftingBrief, { allowAuthorizedShare: allowShare }).valid) {
      content = draft;
      usedDrafter = true;
    } else {
      content = plan.fallbackText;
    }
  } else {
    content = plan.fallbackText;
  }

  // Observabilidad por turno (sin PII: ni nombre ni texto): la llamada deja de ser una caja negra.
  console.log(
    "[call-turn]",
    JSON.stringify({
      signal: result.signal,
      directive: result.directive.type,
      usedDrafter,
      deterministic: Boolean(plan.deterministicText),
      hasContext: Boolean(input.context),
      handoffReason: result.directive.handoffReason ?? null
    })
  );

  return { content, signal: result.signal, directiveType: result.directive.type };
}

// Conocimiento del DM que NO tiene sentido decir EN la llamada (jul-2026, llamada real de Alex): las
// entradas de "agendar la llamada" proponen agendar/te llamamos — absurdo cuando YA estás en la llamada.
const IN_CALL_KNOWLEDGE_BLOCKLIST = new Set(["call-details-after-review", "call-post-summary"]);

/** Entradas de conocimiento aprobado que cubren la pregunta (vacío si ninguna -> se defiere a Alex). */
async function resolveCoveringEntries(question: string, retriever: BusinessKnowledgeRetriever): Promise<KnowledgeEntry[]> {
  const entries = await retriever.retrieve({
    candidate: callKnowledgeCandidate,
    intent: "REQUESTS_INFORMATION",
    question,
    limit: 3,
    ignoreStateGating: true
  });
  return entries.filter((entry) => !IN_CALL_KNOWLEDGE_BLOCKLIST.has(entry.id));
}
