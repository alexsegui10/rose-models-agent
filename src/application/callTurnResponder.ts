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
import {
  decideCallDirective,
  initialCallDirectorState,
  type CallCandidateSignal,
  type CallDirectiveType,
  type CallDirectorState
} from "./callDirector";
import { validateCallUtterance } from "./callRedactionValidator";
import { classifyCallSignal, isTaxDeferTopic } from "./callSignalClassifier";
import { turnMemoryUtteranceKey, type CallTurnMemoryInput, type StoredCallTurnSignal } from "./callTurnMemory";
import { resolveRefinedSignal, type CallUnderstander } from "./callUnderstander";
import { getCallUnderstander } from "./openaiCallUnderstander";
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
   * Capa de COMPRENSIÓN (LLM) opcional: cuando el oído determinista no reconoce una frase REAL (no ruido),
   * entiende qué quiso decir y la mapea a una intención del guion que NO cambia el estado (responder,
   * tranquilizar, aclarar, identidad, ingresos, edad, cara). Solo corre en el turno EN VIVO. Ante fallo ->
   * el turno se queda `unclear` (pedir que repita). Por defecto se resuelve del entorno (clave OpenAI).
   */
  understander?: CallUnderstander;
  /**
   * "Buffer words" (jul-2026): se invoca JUSTO ANTES de llamar al redactor LLM (la única parte lenta)
   * con una muletilla corta ("Vale... ") para que el endpoint la emita ya en streaming y el silencio
   * previo a la respuesta se tape como lo taparía una persona. En los caminos deterministas no se llama
   * (son instantáneos). El texto devuelto por respondToCall NO incluye la muletilla.
   */
  onDraftStart?: (bufferText: string) => void;
  /**
   * MEMORIA DE LLAMADA (Fase 1, 23-jul): señales ya resueltas de turnos previos (cargadas por el endpoint)
   * + cómo persistir la del turno en vivo. OPCIONAL y best-effort: sin ella (simulador, tests, DB caída) el
   * replay usa la re-clasificación de siempre. Un registro solo se aplica si su frase coincide EXACTA con la
   * del transcript en ese índice (candado anti-descuadre); si no, ese turno cae al camino clásico.
   */
  turnMemory?: CallTurnMemoryInput;
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

// Entrada del TIEMPO de dedicación: cuando la comprensión entiende una duda de disponibilidad ("trabajo y
// no sé si tendré tiempo"), se responde con ESTOS hechos aprobados (no jornada completa, unas horas al día,
// compaginable) en vez de una tranquilización genérica anti-estafa (decisión de Alex 8-jul).
const TIME_KNOWLEDGE_ENTRY =
  businessKnowledgeEntries.find(
    (entry) => entry.id === "content-time-commitment" && entry.status === "ACTIVE" && entry.approvedByAlex
  ) ?? null;

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

/**
 * Coletilla-check FINAL corta ("¿vale?", "¿me sigues?", "¿te va?", "¿cómo lo ves?"...). En la 1ª llamada
 * real (17-jul) los 10 turnos del bot acababan en una — el tell de robot nº1 según el panel; criterio de
 * Alex: "el vale me gusta como queda, pero no siempre". Solo casa la LISTA de coletillas cortas: una
 * pregunta REAL (pedir un dato, "¿me lo repites?", la pregunta de una etapa) jamás entra aquí.
 */
// Dos protecciones (revisor Ronda 2): el \b evita cortar POR DENTRO de palabra ("¿Mejor así?" -> "¿Mejor
// a."), y el arranque exige PUNTUACIÓN previa o el "¿" — sin eso, una pregunta REAL que termina en un token
// de la lista se mutilaba ("¿Te viene bien?" -> "¿Te viene.", "¿Tienes OnlyFans o no?" -> "...o."). Una
// coletilla de verdad siempre llega como frase aparte (", ¿vale?" / ". ¿Me sigues?" / " ¿te va?").
const TRAILING_CHECK_CLOSER =
  /(?:[.,;!…—-]\s*¿?|\s¿)\b(?:vale|va|s[ií]|no|eh|bien|ok(?:ey)?|de acuerdo|me sigues|te va(?: bien)?|te parece(?: bien)?|te cuadra(?: as[ií])?|c[oó]mo lo ves|qu[eé] te parece|te encaja(?: as[ií])?|mejor(?: as[ií])?|seguimos|sigo|hasta ah[ií] bien|me explico|lo ves|verdad|sabes|te queda(?: m[aá]s)? claro[^?]{0,35}|alguna (?:otra )?duda[^?]{0,25})\s*\?\s*$/i;

/**
 * Quita la coletilla-check final si la hay (y remata con puntuación limpia). Si la coletilla ERA todo el
 * turno, se conserva tal cual (nunca dejar el turno vacío).
 */
export function stripTrailingCheckCloser(content: string): string {
  const stripped = content.replace(TRAILING_CHECK_CLOSER, "").trim();
  if (stripped.length === 0) return content;
  if (stripped === content.trim()) return content;
  return /[.!…?]$/.test(stripped) ? stripped : `${stripped}.`;
}

/** Ruido de ASR/línea: vacío o solo puntuación ("...", "…"). Compartido por el atajo en vivo y el replay. */
function isNoiseUtterance(utterance: string): boolean {
  return utterance.trim().length === 0 || /^[\s.·…,;:!?-]*$/.test(utterance);
}

const SPANISH_VOWEL = /[aeiouáéíóúü]/;
/**
 * Audio INININTELIGIBLE (no solo puntuación): STT roto tipo "krzt mmm", "sht brr" — fragmentos SIN vocales,
 * que no son lenguaje real. Se distingue del ruido puro (isNoiseUtterance) y de una frase REAL no reconocida
 * ("y si me reconocen"): una frase real tiene al menos un token con vocal. Se usa para decidir qué es "audio
 * roto" (no se manda a comprensión y SÍ acumula la racha de handoff a una persona a los 3 intentos) frente a
 * "lenguaje real que el oído no listó" (se manda a comprensión / se entiende, no cuenta como audio roto). Sin
 * esto, la comprensión neutralizaría el escalado por audio roto (riesgo del revisor jul-2026).
 */
function isUnintelligibleUtterance(utterance: string): boolean {
  if (isNoiseUtterance(utterance)) return true;
  const tokens = utterance.toLowerCase().match(/[a-záéíóúüñ]+/g);
  if (!tokens || tokens.length === 0) return true;
  return tokens.every((token) => !SPANISH_VOWEL.test(token));
}

// ¿La respuesta del bot a un turno indica que EN VIVO se quedó en `unclear`? (replay-safe, 20-jul). El
// transcript es la verdad: si a un turno inteligible-no-entendido el bot respondió PIDIENDO REPETIR
// (ASK_REPEAT) o PASANDO LA LLAMADA (HANDOFF), la comprensión NO lo mapeó y la racha de `unclear` SÍ subió
// (pudo llegar al handoff). Sirve para NO reiniciar esa racha en la reproducción y no OLVIDAR un handoff real.
function botStayedUnclearLive(botResponse: string | undefined): boolean {
  if (!botResponse) return false;
  const n = botResponse.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  // ASK_REPEAT (determinista -> firma fiable).
  if (/no te he pillado|se oye entrecortado|cobertura esta fatal/.test(n)) return true;
  // HANDOFF (redactado por LLM -> firma AMPLIA que cubre lo que empuja el brief: "se pondrá en contacto con
  // ella / la contacta / te contacta / te llama / le paso el testigo / te paso con mi socio"). NO colisiona
  // con DEFER (dice "por WhatsApp" / "te lo confirmo"). Un handoff de más sería fail-safe (escala a humano);
  // olvidar uno rompe el invariante 4, así que se prefiere pecar de detectar (revisor 20-jul).
  return /en contacto|te (?:contacta|contactara|llama|llamara|escribe|escribira)|le paso el testigo|te paso con mi socio|que (?:te|se) (?:llame|contacte|escriba|ponga)/.test(
    n
  );
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
  // Comprensión (LLM) para lo que el oído determinista no reconoce: inyectable en tests; por defecto del
  // entorno (undefined si no hay clave -> comportamiento determinista de siempre). Solo se usa EN VIVO.
  const understander = input.understander ?? getCallUnderstander();

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
    // MEMORIA DE LLAMADA (Fase 1, 23-jul): señales de turnos previos resueltas EN VIVO (incluidas las de la
    // comprensión IA) indexadas por turno. Un registro solo se usa si su frase coincide EXACTA con la del
    // transcript en ese índice (candado anti-descuadre: si ElevenLabs re-fragmenta, cae al camino clásico).
    const memoryByIndex = new Map<number, StoredCallTurnSignal>();
    for (const record of input.turnMemory?.records ?? []) memoryByIndex.set(record.turnIndex, record);
    for (let i = 0; i < userUtterances.length - 1; i++) {
      // Espejo del atajo anti-loro EN VIVO (R1 jul-2026): un turno de ruido tras el estado terminal se
      // respondió con silencio SIN pasar por el director; el replay debe saltarlo igual, o incrementaría
      // un terminalRepeats fantasma y el cierre nunca llegaría a repetirse en vivo.
      if ((state.handedOff || state.closed) && isNoiseUtterance(userUtterances[i])) continue;
      // Turno con señal RECORDADA: se reproduce EXACTA (misma señal + mismo flag de comprensión que en vivo)
      // sin re-clasificar ni reconciliar — la memoria es la verdad. Con candado de frase; si no casa, el
      // resto del camino clásico de abajo sigue intacto (paracaídas).
      const remembered = memoryByIndex.get(i);
      if (remembered && remembered.utterance === turnMemoryUtteranceKey(userUtterances[i])) {
        const decision = decideCallDirective({
          state,
          signal: remembered.signal,
          refinedByUnderstander: remembered.refinedByUnderstander
        });
        directiveRepeats[decision.directive.type] = (directiveRepeats[decision.directive.type] ?? 0) + 1;
        state = decision.nextState;
        continue;
      }
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
      // Reconstrucción consistente con la comprensión EN VIVO (replay-safe): si hay comprensión disponible,
      // una frase REAL que el oído no reconoció (unclear no-ruido) se ENTENDIÓ en su momento como una señal
      // que NO cambia el estado (responder/tranquilizar/...). Aquí NO se re-llama al LLM (sería lento en la
      // reproducción); se reproduce solo su EFECTO en el estado: reinicia las rachas (unclear/repetición) y
      // no toca guion/cierre/negociación. Sin esto, la reproducción contaría esos turnos como "audio roto" y
      // podría disparar un handoff fantasma que en vivo nunca ocurrió. El ruido real sí sigue acumulando.
      if (
        signal === "unclear" &&
        understander &&
        !isUnintelligibleUtterance(userUtterances[i]) &&
        !state.closed &&
        !state.handedOff &&
        // Solo se reinicia la racha si la comprensión SÍ mapeó el turno EN VIVO. La verdad está en el
        // transcript: si el bot respondió a ESTE turno pidiendo repetir o pasando la llamada, en vivo se
        // quedó `unclear` y la racha subió (pudo haber handoff) -> NO se reinicia; cae a decideCallDirective
        // abajo para reproducir el incremento/handoff. Sin esto, un handoff real por audio ininteligible se
        // OLVIDABA al turno siguiente (invariante 4; barrido 20-jul).
        !botStayedUnclearLive(botBefore[i + 1])
      ) {
        if (state.unclearStreak !== 0 || state.repeatRequestStreak !== 0) {
          state = { ...state, unclearStreak: 0, repeatRequestStreak: 0 };
        }
        continue;
      }
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
  // Últimos turnos del bot (20-jul): para que el redactor NO repita lo mismo cuando ella re-pregunta.
  const recentBotUtterances = input.messages
    .filter((m) => m.role === "assistant" && (m.content ?? "").trim().length > 0)
    .slice(-2)
    .map((m) => m.content as string);

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

  // SEÑAL DEL TURNO EN VIVO. El oído determinista PRIMERO (rápido y seguro: edad/%/legal se resuelven aquí).
  // Si NO reconoce una frase REAL (unclear que no es ruido) y hay comprensión disponible fuera de estado
  // terminal, se le pide al modelo que ENTIENDA qué quiso decir y la mapee a una intención que NO cambia el
  // estado (responder/tranquilizar/aclarar/identidad/ingresos/edad/cara). Si no hay comprensión o el modelo
  // no lo entiende, el turno se queda `unclear` (pedir que repita): fallback determinista (invariante 6).
  let liveSignal: CallCandidateSignal | undefined = botHasSpoken ? undefined : "none";
  let liveCoveringEntries = coveringEntries;
  // true si la señal del turno la produjo la COMPRENSIÓN IA (no el oído). Replay-crítico: una señal de IA
  // jamás muta estado (la reproducción no re-llama al LLM); el director lo garantiza con este flag.
  let liveSignalRefined = false;
  if (botHasSpoken) {
    const moneyContext = state.coveredStages.includes("MONEY") || state.revenueShareStep > 0;
    let signal = classifyCallSignal({
      utterance: lastUtterance,
      isCoveredQuestion: coveringEntries.length > 0,
      moneyContext,
      lastBotUtterance
    });
    if (signal === "unclear" && understander && !isUnintelligibleUtterance(lastUtterance) && !terminalBeforeTurn) {
      const intent = await understander.understand({ utterance: lastUtterance, lastBotUtterance, context: input.context });
      const resolution = resolveRefinedSignal(intent);
      if (resolution.kind !== "none") liveSignalRefined = true;
      if (resolution.kind === "signal") {
        signal = resolution.signal;
      } else if (resolution.kind === "question") {
        // El modelo entiende que es una pregunta de negocio: cubierta -> responder; no cubierta -> deferir
        // a Alex por WhatsApp. La COBERTURA la decide el recuperador determinista, no el modelo.
        signal = coveringEntries.length > 0 ? "asks-covered" : "asks-unknown";
      } else if (resolution.kind === "face-concern") {
        // Duda/vergüenza sobre la cara entendida por el modelo: se tranquiliza de forma DETERMINISTA
        // (face-doubt -> RECONDUCT_FACE, texto fijo aprobado), NO con un turno redactado por el LLM. Así el
        // LLM NUNCA redacta sobre la cara (defensa en profundidad del invariante DURO: la cara es
        // innegociable); el guard `promisesFaceConcealment` queda como red para el resto de turnos.
        signal = "face-doubt";
      } else if (resolution.kind === "time-concern") {
        // Duda de tiempo/disponibilidad: responder con el conocimiento del tiempo (no jornada completa, unas
        // horas al día, compaginable) en vez de una tranquilización genérica. Si falta la entrada, distrust.
        if (TIME_KNOWLEDGE_ENTRY) {
          liveCoveringEntries = [TIME_KNOWLEDGE_ENTRY];
          signal = "asks-covered";
        } else {
          signal = "distrust";
        }
      }
      // "smalltalk" -> signal "acknowledge" (via resolveRefinedSignal, arriba en kind "signal"): la comprension
      // entendio que es charla/respuesta, se acusa con naturalidad. "none"/null -> se queda `unclear` (repetir).
    } else if (
      signal === "asks-unknown" &&
      understander &&
      !isUnintelligibleUtterance(lastUtterance) &&
      !terminalBeforeTurn &&
      // Deferencia FISCAL deliberada (decisión de Alex, MEMORY nº7): los impuestos se DEFIEREN aunque el
      // retriever los "cubra" (el bot soltaría el sinsentido de las cuotas). El rescate NO los toca (revisor 20-jul).
      !isTaxDeferTopic(lastUtterance)
    ) {
      // OPCIÓN A "MÁS IA" (Alex 20-jul): antes de DIFERIR a WhatsApp, la IA intenta ENTENDER la intención
      // (rescate de over-defer: "responde lo que pregunta"). SEGURIDAD replay: solo se aplica el rescate si el
      // estado resultante es IDÉNTICO al del `asks-unknown` determinista -> en la reproducción el oído
      // re-deriva asks-unknown y, si el efecto de estado coincide, NO hay divergencia (mismo patrón que #2).
      // Un rescate que MUTA estado (p. ej. cara -> faceObjectionCount) se DESCARTA y el turno sigue difiriendo
      // (seguro). El %/negociación/edad NO llegan aquí (el oído los resuelve antes); la IA solo rescata
      // relevancia, nunca decide dinero (invariante 1). Coste: 1 llamada IA en un turno que ya iba a diferir.
      const intent = await understander.understand({ utterance: lastUtterance, lastBotUtterance, context: input.context });
      const resolution = resolveRefinedSignal(intent);
      let rescued: CallCandidateSignal | undefined;
      let rescuedCovering: typeof coveringEntries | undefined;
      if (resolution.kind === "signal") {
        rescued = resolution.signal;
      } else if (resolution.kind === "time-concern" && TIME_KNOWLEDGE_ENTRY) {
        rescued = "asks-covered";
        rescuedCovering = [TIME_KNOWLEDGE_ENTRY];
      }
      // NOTA: la rama "question -> asks-covered" se quitó (revisor 20-jul): para una pregunta normal cubierta el
      // oído ya devuelve asks-covered (no llega aquí); solo era alcanzable en el caso fiscal, que se DEFIERE.
      // face-concern / question / none -> NO se rescata (se queda asks-unknown = defer seguro).
      if (rescued) {
        // La comparación usa refinedByUnderstander:true (la señal ES de la IA): así asks-earnings, que con el
        // flag no muta estado, sigue siendo rescatable a la respuesta honesta de ingresos.
        const deterministicNext = JSON.stringify(decideCallDirective({ state, signal: "asks-unknown" }).nextState);
        const rescuedNext = JSON.stringify(
          decideCallDirective({ state, signal: rescued, refinedByUnderstander: true }).nextState
        );
        if (rescuedNext === deterministicNext) {
          signal = rescued; // replay-safe: mismo efecto de estado que el asks-unknown determinista
          liveSignalRefined = true;
          if (rescuedCovering) liveCoveringEntries = rescuedCovering;
        }
      }
    }
    liveSignal = signal;
    // MEMORIA DE LLAMADA: persiste la señal resuelta EN VIVO (con su procedencia) para que el próximo turno
    // la reproduzca exacta. Fire-and-forget: jamás añade latencia ni puede romper el turno (paracaídas).
    if (input.turnMemory?.save && userUtterances.length > 0) {
      const record: StoredCallTurnSignal = {
        turnIndex: userUtterances.length - 1,
        utterance: turnMemoryUtteranceKey(lastUtterance),
        signal,
        refinedByUnderstander: liveSignalRefined
      };
      void input.turnMemory.save(record).catch(() => {});
    }
  }

  // ANTI-DISCO-RAYADO del "no te pillo" (sweep R9 10-jul): con la comprensión activa, el replay SALTA los
  // turnos unclear-reales (no cuentan en directiveRepeats), así que dos ASK_REPEAT consecutivos salían con
  // el MISMO texto ("no te he pillado bien" x2, fingiendo sordera en bucle). El transcript es la fuente de
  // verdad: se cuentan los ASK_REPEAT que el bot YA DIJO (sus variantes son fijas) y se usa como suelo del
  // índice de repetición — la 2ª vez sale otra formulación. Determinista y replay-safe (solo lee mensajes).
  const askRepeatAlreadySaid = input.messages.filter(
    (m) => m.role === "assistant" && /no te he pillado bien|se oye entrecortado|cobertura.{0,4}fatal/i.test(m.content ?? "")
  ).length;
  if (askRepeatAlreadySaid > (directiveRepeats.ASK_REPEAT ?? 0)) {
    directiveRepeats.ASK_REPEAT = askRepeatAlreadySaid;
  }

  const result = runCallTurn({
    state,
    utterance: lastUtterance,
    candidateName: input.candidateName ?? input.context?.candidateName,
    recorded: input.recorded,
    context: input.context,
    // Señal ya resuelta arriba (oído determinista + comprensión). En apertura (el bot aún no habló): "none".
    signal: liveSignal,
    signalRefinedByUnderstander: liveSignalRefined,
    resolveQuestion: () => liveCoveringEntries,
    // Memoria de la llamada (jul-2026): lo que ELLA ya dijo en cualquier turno (extractor determinista),
    // para que el redactor no re-pregunte y pueda referenciarlo. No decide nada (solo informa).
    callFacts: extractCallFacts(userUtterances),
    directiveRepeats,
    lastBotUtterance,
    recentBotUtterances
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
    // Turno de DEFER: no puede EMPEZAR con "Sí/No" — ante una pregunta polar eso la RESPONDE y contradice
    // el defer en el mismo turno ("No, tranquila... eso lo confirmo" — sweep R9 10-jul).
    const noPolarOpener = result.directive.type === "DEFER_TO_PARTNER";
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
        noContactTimePromise,
        noPolarOpener
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

  // ALTERNANCIA de coletillas-check (Ronda 2, 17-jul): si el turno ANTERIOR del bot ya acabó en pregunta,
  // este NO vuelve a rematar con una coletilla de confirmación corta — encadenarlas en todos los turnos era
  // el tell de robot nº1 (panel de la 1ª llamada real; Alex: "el vale me gusta como queda, pero no siempre").
  // Determinista y replay-safe (depende solo del transcript). REPEAT_LAST_UTTERANCE se excluye (el eco debe
  // ser fiel) y CLOSE_UNDERAGE también (el corte de menor no se retoca — invariante 2).
  if (
    content &&
    /\?\s*$/.test((lastBotUtterance ?? "").trim()) &&
    result.directive.type !== "REPEAT_LAST_UTTERANCE" &&
    result.directive.type !== "CLOSE_UNDERAGE"
  ) {
    content = stripTrailingCheckCloser(content);
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
// content-boundaries-neutral-question (17-jul, 1a llamada real): Alex — "los limites los quitas de la
// llamada, no quiero hablar de eso". El buscador la servia hasta para "¿que es Drive?" y el bot soltaba la
// pregunta de limites sin venir a cuento. Fuera de la llamada SIEMPRE (tambien reactivo): si ella pregunta
// por limites, cae a DEFER -> "te lo paso por WhatsApp", que es donde Alex los trata.
const IN_CALL_KNOWLEDGE_BLOCKLIST = new Set([
  "call-details-after-review",
  "call-post-summary",
  "content-boundaries-neutral-question"
]);

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
