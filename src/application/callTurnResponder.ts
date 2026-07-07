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

// Muletillas por directiva para tapar la latencia del redactor (elegidas para no chocar con los arranques
// típicos del fallback de cada directiva). La elipsis + espacio final es el formato que la plataforma de
// voz pronuncia con pausa natural sin distorsión. ROTAN por turno (jul-2026: en la simulación el "A ver..."
// idéntico en cada turno sonaba a disco rayado); la rotación es determinista (nº de turnos), replay-safe.
const DRAFT_BUFFER_WORDS: Partial<Record<CallDirectiveType, string[]>> = {
  COVER_STAGE: ["Vale... ", "Perfecto... ", "Muy bien... "],
  ANSWER_FROM_KNOWLEDGE: ["A ver... ", "Pues mira... ", "Claro... "],
  REASSURE: ["Ya... ", "Te entiendo... "],
  DEFER_TO_PARTNER: ["Pues... ", "Mmm... "],
  GIVE_IDENTITY: ["Eh... "],
  CLARIFY_LAST_UTTERANCE: ["O sea... ", "Pues mira... "],
  REPEAT_LAST_UTTERANCE: ["Sí, claro... "]
};

function draftBufferWord(directive: CallDirectiveType, turnIndex: number): string {
  const options = DRAFT_BUFFER_WORDS[directive] ?? ["Eh... "];
  return options[turnIndex % options.length];
}

/** Ruido de ASR/línea: vacío o solo puntuación ("...", "…"). Compartido por el atajo en vivo y el replay. */
function isNoiseUtterance(utterance: string): boolean {
  return utterance.trim().length === 0 || /^[\s.·…,;:!?-]*$/.test(utterance);
}

export async function respondToCall(input: RespondToCallInput): Promise<CallResponderResult> {
  // Turnos de la candidata + lo ÚLTIMO que dijo el BOT antes de cada uno (para las señales de
  // aclaración/repetición: "¿qué significa X?" solo es aclaración si X está en la frase previa del bot).
  //
  // FUSIÓN de turnos consecutivos (3-jul, llamada real de Alex — el bot "se saltó el guion"): cuando la
  // candidata suelta VARIOS turnos seguidos SIN que el bot conteste entre medias (pasa cuando no puede
  // interrumpirla y ella habla por encima: "Sí", "Ya", "¿qué?", "para para"), ElevenLabs los manda como
  // turnos separados. El replay avanzaba UNA etapa por turno pero solo VOCALIZABA la última → se saltaban
  // etapas en voz. Si el bot no llegó a hablar entre dos turnos suyos, es UN turno (habló seguido), no N
  // avances de guion: se funden en uno.
  const userUtterances: string[] = [];
  const botBefore: Array<string | undefined> = [];
  let lastAssistant: string | undefined;
  let botSpokeSinceLastUser = true;
  for (const message of input.messages) {
    if (message.role === "assistant" && (message.content ?? "").trim().length > 0) {
      lastAssistant = message.content;
      botSpokeSinceLastUser = true;
    } else if (message.role === "user") {
      const content = message.content ?? "";
      if (botSpokeSinceLastUser || userUtterances.length === 0) {
        userUtterances.push(content);
        botBefore.push(lastAssistant);
        botSpokeSinceLastUser = false;
      } else {
        // Tope defensivo (nota del revisor): un ASR patológico podría mandar decenas de fragmentos; el
        // turno fundido se acota (2000 chars sobran para cualquier turno real de voz) para no inflar el
        // brief del redactor ni la recuperación. Las señales ya se detectan en los primeros caracteres.
        const merged = `${userUtterances[userUtterances.length - 1]} ${content}`.trim();
        userUtterances[userUtterances.length - 1] = merged.length > 2000 ? merged.slice(0, 2000) : merged;
      }
    }
  }

  // La apertura legal se considera dada SOLO si el BOT ya habló (mensaje assistant no vacío). NO se infiere
  // de que la candidata haya hablado: si ella habla primero, el bot debe abrir igualmente con la locución
  // legal (no perderla nunca; riesgo EU AI Act / RGPD).
  const botHasSpoken = input.messages.some((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0);

  // ¿La candidata HABLÓ ANTES de que el bot abriera? (3-jul, llamada real: descolgó diciendo "Sí?" y el
  // ASR lo transcribió antes de la apertura). En ese caso, la APERTURA fue la respuesta a ese primer turno
  // suyo — NO una etapa del guion. El replay, que avanza una etapa por turno suyo ya respondido, se
  // descuadraba en uno y SALTABA la 1ª etapa ("cómo trabajamos"). Se corrige saltando ese primer turno.
  const firstRealMessage = input.messages.find((m) => m.role !== "system" && (m.content ?? "").trim().length > 0);
  const candidateSpokeFirst = firstRealMessage?.role === "user";

  // Interruptor de la apertura legal. Por defecto ACTIVA (es obligatoria por ley antes de una llamada
  // real). CALL_DISCLOSURE=off la desactiva SOLO para pruebas; debe volver a ON antes de producción.
  const disclosureEnabled = process.env.CALL_DISCLOSURE !== "off";

  let state: CallDirectorState = initialCallDirectorState();
  if (!disclosureEnabled) {
    state = { ...state, disclosureGiven: true };
  }
  let lastUtterance = "";

  // Memoria de repetición (anti-bucle jul-2026): cuántas veces se dio YA cada directiva en la llamada.
  // Se calcula durante el replay (determinista) y selecciona variantes de texto para no repetirse.
  const directiveRepeats: Partial<Record<CallDirectiveType, number>> = {};

  const replayRetriever = input.retriever ?? defaultRetriever;
  const answerEnabled = input.answerFromKnowledge !== false;

  if (botHasSpoken) {
    // Consume el primer turno del bot y reproduce los turnos previos de la candidata para reconstruir el
    // estado. DOS casos:
    //  - Bot habló primero (o modo prueba sin disclosure): su 1er turno fue "de inicio" (apertura / 1ª
    //    etapa) sin input previo -> se consume con una decisión 'none'.
    //  - La candidata habló ANTES de la apertura (descolgó diciendo "Sí?"): su 1er turno lo respondió la
    //    APERTURA, no una etapa. NO se hace 'opening' artificial; ese turno se procesa en el loop con el
    //    estado fresco -> el director da GIVE_DISCLOSURE (o CLOSE_UNDERAGE si declaró menor: la SEGURIDAD
    //    no se pierde). Así no se descuadra en uno ni se salta la 1ª etapa (bug real 3-jul).
    const candidateFirstConsumedDisclosure = candidateSpokeFirst && disclosureEnabled;
    if (!candidateFirstConsumedDisclosure) {
      const opening = decideCallDirective({ state, signal: "none" });
      directiveRepeats[opening.directive.type] = (directiveRepeats[opening.directive.type] ?? 0) + 1;
      state = opening.nextState;
    }
    for (let i = 0; i < userUtterances.length - 1; i++) {
      // Espejo del atajo anti-loro EN VIVO (R1 jul-2026): un turno de ruido tras el estado terminal se
      // respondió con silencio SIN pasar por el director; el replay debe saltarlo igual, o incrementaría
      // un terminalRepeats fantasma y el cierre nunca llegaría a repetirse en vivo.
      if ((state.handedOff || state.closed) && isNoiseUtterance(userUtterances[i])) continue;
      const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
      // El replay clasifica con el MISMO conocimiento que el turno en vivo (riesgo del revisor jul-2026):
      // sin esto, una pregunta respondida en vivo (asks-covered) se re-contaba como DEFER y la primera
      // deferida real salía con la variante "también..." que presupone una anterior. Solo afecta a los
      // CONTADORES (esas señales no mutan estado); el recuperador es local y barato.
      const covered =
        answerEnabled && userUtterances[i].trim().length > 0
          ? (await resolveCoveringEntries(userUtterances[i], replayRetriever)).length > 0
          : false;
      const signal = classifyCallSignal({
        utterance: userUtterances[i],
        isCoveredQuestion: covered,
        moneyContext,
        lastBotUtterance: botBefore[i]
      });
      const decision = decideCallDirective({ state, signal });
      directiveRepeats[decision.directive.type] = (directiveRepeats[decision.directive.type] ?? 0) + 1;
      state = decision.nextState;
    }
    lastUtterance = userUtterances[userUtterances.length - 1] ?? "";
  }

  // Conocimiento que cubre la pregunta del turno EN VIVO (solo si responder está activo y hay texto).
  const coveringEntries =
    answerEnabled && lastUtterance.trim().length > 0 ? await resolveCoveringEntries(lastUtterance, replayRetriever) : [];

  // Lo último que DIJO EL BOT (para "¿qué decías?"/aclaraciones): ya lo dejó calculado el barrido de
  // mensajes de arriba (es el último assistant no vacío del transcript).
  const lastBotUtterance = lastAssistant;

  // ANTI-LORO tras el final (jul-2026, llamada real de Alex: 8 MINUTOS repitiendo "te paso con mi socio"
  // cada 15s al ASR mandando "..."): con la llamada YA transferida o cerrada ANTES de este turno, un turno
  // de ruido/silencio no repite el cierre — se calla (""). El colgado real lo pone ElevenLabs (timeout de
  // silencio del agente); esto evita quemar minutos hablando solo. Si dice algo REAL tras el cierre, el
  // director sigue decidiendo (repetir el cierre una vez / escalar por seguridad) como siempre.
  const terminalBeforeTurn = state.handedOff || state.closed;
  if (botHasSpoken && terminalBeforeTurn && isNoiseUtterance(lastUtterance)) {
    // Traza honesta (R2 jul-2026): el silencio se reporta como lo que es (STAY_SILENT), no como si se
    // hubiera dicho el cierre/handoff.
    console.log("[call-turn]", JSON.stringify({ signal: "noise-after-terminal", directive: "STAY_SILENT", usedDrafter: false }));
    return { content: "", signal: "unclear", directiveType: "STAY_SILENT" };
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
    callFacts: extractCallFacts(userUtterances),
    directiveRepeats,
    lastBotUtterance
  });

  const plan = result.utterancePlan;
  let content: string;
  let usedDrafter = false;
  if (plan.deterministicText !== undefined) {
    // Crítico/guion (apertura, cifra del reparto, handoff, cierre, silencio anti-loro): NUNCA pasa por el
    // LLM. El vacío ("" de STAY_SILENT) es determinista válido: significa callarse.
    content = plan.deterministicText;
  } else if (plan.draftingBrief && input.drafter) {
    // Buffer words: avisar al endpoint ANTES de la única espera lenta (el LLM), para que la voz ya esté
    // diciendo algo ("Vale... ") mientras se redacta. Sin drafter no hay espera y no se emite nada.
    // La muletilla rota por turno para no repetirse (determinista: nº de turnos de la candidata).
    input.onDraftStart?.(draftBufferWord(result.directive.type, userUtterances.length));
    // Redacción natural por LLM, SOLO si pasa el validador de voz; si no, fallback determinista (inv. 6).
    const draft = await input.drafter.draft({
      brief: plan.draftingBrief,
      context: input.context,
      directiveType: result.directive.type
    });
    // Cifras del reparto SOLO en el turno de dinero (endurecimiento R1 jul-2026): en cualquier otro turno
    // redactado, un porcentaje —aunque sea el autorizado— está fuera de sitio y tira el draft al fallback.
    // Y un draft JAMÁS se despide (los cierres son deterministas): despedida improvisada -> fallback.
    const allowShare = result.directive.type === "COVER_STAGE" && result.directive.stageId === "MONEY";
    // Turno de INGRESOS ("cuanto se gana"): barrera ABSOLUTA de cifras. Ningun numero es legitimo ahi, asi que
    // cualquier cifra que colara el LLM tira el draft al fallback determinista (invariante de ingresos).
    const noMoneyFigures = result.directive.type === "GIVE_EARNINGS";
    // Turno de HANDOFF: el bot no promete CUANDO contactara Alex (eso lo fija Alex). La red veta dia/hora
    // concretos; sin esto solo lo cubria el prompt del brief.
    const noContactTimePromise = result.directive.type === "HANDOFF_TO_ALEX";
    // Emojis fuera del canal de VOZ (3-jul): el redactor a veces cuela un 😄 y el TTS lo lee raro o lo
    // ignora con pausa; se eliminan del texto hablado (el humor va en las palabras).
    const spokenDraft = draft
      ?.replace(/\p{Extended_Pictographic}/gu, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (
      spokenDraft &&
      validateCallUtterance(spokenDraft, plan.draftingBrief, {
        allowAuthorizedShare: allowShare,
        allowFarewell: false,
        noMoneyFigures,
        noContactTimePromise
      }).valid
    ) {
      content = spokenDraft;
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
      deterministic: plan.deterministicText !== undefined,
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
