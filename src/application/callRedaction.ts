/**
 * "Boca" del bot de llamada: convierte una directiva del director en QUÉ se dice. NO llama al LLM aquí
 * (eso es del adaptador/endpoint); produce un PLAN de enunciado:
 *  - `deterministicText`: para lo crítico/seguro (apertura legal, deferir, handoff, cierre, la CIFRA del
 *    reparto) se dice tal cual, sin LLM.
 *  - `draftingBrief`: para lo explicativo (etapas, responder, tranquilizar) se da una instrucción + los
 *    hechos APROBADOS del conocimiento en los que apoyarse, para que el LLM lo redacte natural.
 *  - `fallbackText`: SIEMPRE presente (invariante 6): si el LLM falla o no aplica, esto se dice. Las
 *    afirmaciones de negocio del fallback salen del conocimiento aprobado o de la cifra autorizada del
 *    reparto; solo el "pegamento" conversacional (saludo, encuadre, pregunta de límites) es guion.
 *
 * Invariante 1: el plan lo determina el código a partir de la directiva; el LLM solo redacta dentro de
 * los hechos del brief. Invariante 3: la cifra del reparto viene de la directiva (callNegotiation), nunca
 * del LLM.
 */

import type { KnowledgeEntry } from "@/domain/businessKnowledge";
import { validateCallUtterance } from "./callRedactionValidator";
import { callAgendaStage, type CallAgendaStageId } from "./callAgenda";
import type { CallContext } from "./callContext";
import { callOpeningDisclosure } from "./callDisclosure";
import type { CallDirective } from "./callDirector";
import type { CallRevenueShareOffer } from "./callNegotiation";

export interface CallDraftingBrief {
  /** Qué tiene que comunicar el bot este turno. */
  instruction: string;
  /** Hechos APROBADOS en los que apoyarse (el LLM no inventa fuera de aquí). */
  groundingFacts: string[];
  /** Lo que NO puede decir (de prohibitedClaims del conocimiento). */
  prohibitedClaims: string[];
  /** Matices obligatorios (mandatoryNuances). */
  mandatoryNuances: string[];
  /** Si conviene referenciar el DM ("como te dije por Instagram"), para que se note que es la misma persona. */
  referenceInstagram: boolean;
  /** Contexto de la candidata (nombre, dudas previas, resumen del DM) para personalizar la redacción. */
  context?: CallContext;
  /**
   * Lo ÚLTIMO que dijo la candidata (texto de STT): el redactor le responde PRIMERO a esto con
   * naturalidad y luego cumple el objetivo del turno ("responde primero, luego reconduce").
   */
  candidateUtterance?: string;
  /** Etiquetas de los temas de la agenda YA tratados (para no repetirlos; el orden lo decide el código). */
  coveredTopics?: string[];
  /** Etiquetas de los temas que QUEDAN (para hilar transiciones; NUNCA se anuncian como lista). */
  pendingTopics?: string[];
  /** Hechos que ELLA ya dijo en ESTA llamada (extraídos determinista): no re-preguntar, referenciar. */
  callFacts?: string[];
}

export interface CallUtterancePlan {
  directiveType: CallDirective["type"];
  /** Texto determinista listo para decir. Si está, se usa tal cual (sin LLM). */
  deterministicText?: string;
  /** Brief para redactar con LLM (cuando no es determinista). */
  draftingBrief?: CallDraftingBrief;
  /** Respaldo determinista SIEMPRE presente (invariante 6). */
  fallbackText: string;
}

export interface PlanCallUtteranceInput {
  directive: CallDirective;
  candidateName?: string;
  recorded?: boolean;
  /** Conocimiento de apoyo: de la etapa (COVER_STAGE) o recuperado por la pregunta (ANSWER/REASSURE). */
  knowledge?: KnowledgeEntry[];
  /** Contexto de la candidata (del DM). Se adjunta al brief y aporta el nombre si no se pasó aparte. */
  context?: CallContext;
  /** Lo último que dijo la candidata (para que el redactor le responda primero y luego reconduzca). */
  utterance?: string;
  /** Temas de agenda ya tratados / pendientes (etiquetas), para el brief. El orden lo decide el director. */
  coveredTopics?: string[];
  pendingTopics?: string[];
  /** Hechos que ella ya dijo en esta llamada (extractor determinista). */
  callFacts?: string[];
  /**
   * Veces que esta MISMA directiva ya se dio en la llamada (0 = primera). Lo calcula el replay del
   * responder. Selecciona la variante determinista (anti-bucle) y avisa al redactor de que no se repita.
   */
  repetitionIndex?: number;
  /** Lo último que DIJO EL BOT (del transcript), para REPEAT_LAST_UTTERANCE ("¿qué decías?"). */
  lastBotUtterance?: string;
}

// ANTI-BUCLE (jul-2026, feedback de Alex "está lleno de bucles"): las directivas que pueden repetirse
// tienen VARIANTES deterministas — la 1ª vez el texto completo, las siguientes una formulación distinta y
// más corta (repetir la misma frase idéntica es lo que suena a robot). El índice lo aporta el replay
// (nº de veces que esa directiva YA se dio en la llamada); todas las variantes respetan los invariantes
// (sin cifras nuevas, sin promesas). Se elige con min(indice, última): no rota en círculo.
function variantFor(texts: readonly string[], repetitionIndex: number): string {
  return texts[Math.min(repetitionIndex, texts.length - 1)];
}

const DEFER_TEXTS = [
  "Mira, eso lo confirmo con mi socio y te lo digo ahora por WhatsApp, ¿vale?",
  "Eso también te lo confirmo por WhatsApp ahora al colgar, que no te quiero decir nada inexacto.",
  "Pues eso va en el mismo paquete: te lo confirmo por escrito ahora, ¿vale?"
] as const;
const DEFER_TEXT = DEFER_TEXTS[0];
const HANDOFF_TEXTS = [
  "Te entiendo. Mira, para esto lo mejor es que lo veas directamente con mi socio; ahora mismo le digo que se ponga en contacto contigo, ¿vale?",
  "Que sí, de verdad: ya le he avisado y en un ratito se pone él en contacto contigo, tranquila."
] as const;
const CLOSE_TEXTS = [
  "Pues con esto te haces una idea de cómo trabajamos. Después de la llamada te paso el contrato, unas guías y el guion de OnlyFans, para que lo leas todo con calma; y cualquier duda que te surja, me la dices, ¿vale?",
  "Eso, pues nada más por mi parte: ahora al colgar te mando el contrato y las guías y lo miras con calma, ¿vale?"
] as const;
const IDENTITY_TEXTS = [
  "Soy Alex, de Rose Models, la agencia; te escribí por Instagram hace nada. ¿Te sigo contando cómo trabajamos?",
  "Que soy Alex, el de Rose Models, el que te escribió por Instagram. Tranquila, que es rapidito."
] as const;
// Ingresos: respuesta HONESTA determinista, SIN cifras ni promesas (invariante: no prometer ingresos).
const EARNINGS_TEXTS = [
  "Con sinceridad, depende mucho de ti: de tu constancia y de la calidad del contenido. No te puedo prometer una cifra porque sería mentirte. ¿Te sigo contando cómo trabajamos?",
  "Pues como te decía, ahí no te voy a dar una cifra porque sería inventármela: depende de tu constancia y del contenido que subas."
] as const;
// Política de edad: requisito INNEGOCIABLE (solo 18+). Respuesta determinista, jamás se defiere ni se
// suaviza (invariante 2: con la edad no se juega). El redactor NO la toca.
const AGE_POLICY_TEXT =
  "Pues mira, con eso somos súper estrictos: solo trabajamos con chicas mayores de dieciocho años, sin excepción. ¿Te sigo contando?";

/**
 * Guion propio de la LLAMADA por etapa (lo que dice el bot, en la voz de Alex). Es texto pensado para
 * hablar (no los snippets cortos del chat). El conocimiento sigue alimentando el brief del LLM y los
 * hechos; estas son las líneas deterministas de la llamada. MONEY se construye con la cifra autorizada.
 */
// Guion conversacional (Alex jun-2026): turnos cortos que terminan invitando a responder, pero SIN
// preguntar en cada frase (solo en los momentos clave). La cara y la privacidad NO se mencionan
// proactivamente: solo se responden si la candidata pregunta (las cubre el conocimiento de forma reactiva).
const CALL_SCRIPT: Partial<Record<CallAgendaStageId, string>> = {
  HOW_AGENCY_WORKS:
    "Pues mira, como veías por Instagram, es fácil: tú solo te encargas de mandarnos el contenido, del resto nos ocupamos nosotros. El tráfico lo generamos con cuentas de Instagram españolas y, cuando cogen seguidores, ponemos el link a tu OnlyFans. Un equipo de chatters lo lleva las 24 horas, tú no escribes con nadie. ¿Me sigues?",
  HER_RESPONSIBILITIES:
    "Por tu parte es sencillo: tú creas el contenido y lo subes a una carpeta de Drive que compartimos contigo. Y para que sepas qué tipo de contenido va bien, te pasamos por WhatsApp unos perfiles de referencia, tanto para Instagram como para OnlyFans. ¿Vale?",
  CONTENT_AND_FACE:
    "Sobre el contenido: al principio son unos cinco días más suaves, dos o tres fotos al día, y luego vamos pasando a vídeos cada semana. Nosotros te vamos guiando, así que tranquila. ¿Todo bien?",
  BOUNDARIES:
    "Una última cosa que siempre pregunto: ¿hay algún tipo de contenido que no quieras hacer o algún límite que deba tener en cuenta? Lo respetamos sin problema."
};
// Cierre cálido sin contrato (no le interesa): no se presiona, puerta abierta.
const CLOSE_SOFT_TEXTS = [
  "Te entiendo perfectamente, sin ningún problema. Lo dejamos aquí entonces; si en algún momento te animas, aquí nos tienes, ¿vale? Gracias por tu tiempo y un saludo.",
  "Nada, de verdad, sin ningún problema. ¡Que te vaya muy bien!"
] as const;
// La pillamos en MAL MOMENTO nada más descolgar (jul-2026): cerrar rápido y reagendar por Instagram (el
// sistema reabre el agendado por el DM). Sin contrato: aún no se le explicó nada.
const CLOSE_RESCHEDULE_TEXTS = [
  "Tranquila, sin problema, te pillo en mal momento. Te escribo por Instagram y buscamos otro hueco que te venga bien, ¿vale? ¡Hablamos!",
  "Eso, tranquila: ahora te escribo por Instagram y lo movemos a otro día. ¡Hablamos!"
] as const;
// Corte seguro por minoría de edad (invariante 2): cierre educado y definitivo, sin valoraciones
// personales. La variante de repetición mantiene EXACTAMENTE la misma firmeza (no se suaviza).
const CLOSE_UNDERAGE_TEXTS = [
  "Gracias por tu tiempo, pero solo trabajamos con personas mayores de edad, así que no podemos seguir adelante. Te deseo lo mejor, un saludo.",
  "De verdad que no podemos seguir: solo trabajamos con personas mayores de edad. Un saludo."
] as const;
// Defensa del 70 una vez antes de bajar (el porqué del reparto; el modelo de la agencia ya documentado).
// Defensa HONESTA del reparto (fix Alex jun-2026): la AGENCIA se queda el 70 PORQUE hace todo el
// trabajo; ella se queda el 30. NUNCA decir "ese 70 es para ti" (era un bug que invertía el reparto).
const DEFEND_SHARE_TEXT =
  "Te entiendo, es justo preguntarlo. Mira, nosotros nos quedamos ese 70% porque hacemos todo el trabajo: el tráfico, el equipo de chatters las 24 horas y toda la gestión, y tú solo subes el contenido. Por eso el reparto es así. ¿Cómo lo ves?";
// No se entendió bien lo que dijo (ruido/STT): pedir que lo repita, sin asumir asentimiento.
const ASK_REPEAT_TEXTS = [
  "Perdona, no te he pillado bien con la línea. ¿Me lo puedes repetir?",
  "Uy, es que se oye entrecortado. ¿Me lo dices otra vez?",
  "Perdona, de verdad, la cobertura está fatal. ¿Qué me decías?"
] as const;
// Prefijo de la repetición ("¿qué decías?"). Constante para poder RECORTARLO si lo último dicho ya era
// una repetición (evita el anidamiento "Sí, te decía: Sí, te decía: ...").
const REPEAT_PREFIX = "Sí, te decía: ";

// Muletillas de arranque que el streaming antepone al turno hablado ("Vale... ", "Muy bien... "): se
// recortan del ECO para no decir "Sí, te decía: Vale... Claro..." (3-jul, transcripción real).
const SPOKEN_PREFIX = /^(?:vale|perfecto|muy bien|a ver|pues mira|claro|ya|te entiendo|pues|mmm+|eh+|o sea|si)\s*[.…]{1,3}\s*/i;
function stripSpokenPrefixes(text: string): string {
  let out = text.trim();
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(SPOKEN_PREFIX, "").trim();
  }
  return out;
}

// "Repíteme LO DE X": tema concreto que pidió re-oír (última coincidencia gana: "lo de on-- lo de onlyfans").
function repeatTopicFrom(utterance?: string): string | undefined {
  if (!utterance) return undefined;
  const matches = [
    ...utterance.toLowerCase().matchAll(/(?:lo|eso|la parte)\s+de(?:l)?\s+([a-záéíóúñ0-9][a-záéíóúñ0-9\s]{2,28})/g)
  ];
  const last = matches.at(-1)?.[1]?.trim();
  if (!last) return undefined;
  return last.split(/[.,;!?]/)[0].trim() || undefined;
}

// Tranquilizar desconfianza sin conocimiento recuperado: fallback determinista con variante.
const REASSURE_FALLBACK_TEXTS = [
  "Te entiendo, es normal tener dudas. Vamos paso a paso y sin compromiso. Y lo importante: el dinero lo cobras tú directamente en tu cuenta y luego nos pasas nuestra parte, así que el dinero pasa primero por ti. ¿Qué es lo que más te preocupa?",
  "Que es normal, de verdad, no te preocupes. Tú no te comprometes a nada hoy: lo lees todo con calma y me preguntas lo que quieras."
] as const;

/**
 * Aviso al redactor cuando esta directiva YA se usó antes en la llamada: que no suene a disco rayado.
 * Solo naturalidad — los hechos permitidos no cambian (el validador sigue detrás).
 */
function repeatHint(input: PlanCallUtteranceInput): string {
  return (input.repetitionIndex ?? 0) > 0
    ? " OJO: en esta llamada ya usaste antes una respuesta de este tipo — usa OTRA formulación distinta y más corta, sin repetir frases que ya dijiste."
    : "";
}

// Despedida corta cuando ELLA se despide con la llamada ya cerrada (jul-2026): humana y breve, sin
// re-explicar nada (el cierre ya se dio). El colgado lo pone la plataforma de voz. Tras un cierre
// CÁLIDO (no le interesa) NO se promete escribirle ni se celebra ("¡Genial!") su rechazo.
const GOODBYE_TEXT = "¡Genial! Pues eso es todo, ahora te escribo. Un abrazo, ¡chao!";
const GOODBYE_AFTER_DECLINE_TEXT = "Nada, gracias a ti por el ratito. ¡Que te vaya muy bien, un saludo!";

/** Convierte una directiva del director en un plan de enunciado. */
export function planCallUtterance(input: PlanCallUtteranceInput): CallUtterancePlan {
  const { directive } = input;

  switch (directive.type) {
    case "GIVE_DISCLOSURE": {
      const candidateName = input.candidateName ?? input.context?.candidateName;
      const text = callOpeningDisclosure({ candidateName, recorded: input.recorded });
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "DEFER_TO_PARTNER": {
      // Deferir con NATURALIDAD (jul-2026): el redactor adapta el "eso te lo confirmo" a LO QUE ella
      // preguntó (una pregunta personal no se defiere a "mi socio", se sale del paso con simpatía). La
      // DECISIÓN de deferir sigue siendo del código; sin redactor, el texto fijo de siempre (fallback).
      const deferFallback = variantFor(DEFER_TEXTS, input.repetitionIndex ?? 0);
      return {
        directiveType: directive.type,
        draftingBrief: {
          instruction:
            "No tienes la respuesta segura a lo que acaba de decir. NO respondas su pregunta ni afirmes NINGÚN dato nuevo: si es una duda del negocio, dile con naturalidad que eso prefieres confirmarlo y se lo mandas por WhatsApp en cuanto colguéis; si es una pregunta personal o de charla, sal del paso con simpatía (sin inventar datos personales) y retoma la conversación con suavidad." +
            repeatHint(input),
          groundingFacts: [],
          prohibitedClaims: ["Cualquier dato, servicio o cifra de la agencia que no esté en los hechos aprobados"],
          mandatoryNuances: [],
          referenceInstagram: false,
          context: input.context,
          ...briefExtras(input)
        },
        fallbackText: deferFallback
      };
    }
    case "HANDOFF_TO_ALEX": {
      const text = variantFor(HANDOFF_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "CLOSE_WITH_CONTRACT": {
      const text = variantFor(CLOSE_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "GIVE_IDENTITY":
      // Identidad con naturalidad (jul-2026): el redactor responde a CÓMO lo preguntó ella ("¿quién
      // eres?", "¿cuántos años tienes?") sin inventar datos; los hechos son fijos. Fallback determinista.
      return {
        directiveType: directive.type,
        draftingBrief: {
          instruction:
            "Se está preguntando quién eres. Respóndele directo y con simpatía a como lo haya preguntado, presentándote solo con los hechos de abajo, y retoma la conversación. Si pregunta algo personal que no está en los hechos (tu edad, dónde vives), sal del paso con humor ligero SIN inventarte datos." +
            repeatHint(input),
          groundingFacts: [
            "Eres Alex, de Rose Models, la agencia.",
            "Le escribiste tú por Instagram hace poco y quedasteis en hablar por teléfono."
          ],
          prohibitedClaims: [
            "Datos personales inventados (edad, ciudad, historia personal)",
            "Afirmar que eres una persona/humano o negar ser una IA (si pregunta si eres un robot, quita hierro con simpatía y redirige, sin confirmar ni negar)"
          ],
          mandatoryNuances: [],
          referenceInstagram: true,
          context: input.context,
          ...briefExtras(input)
        },
        fallbackText: variantFor(IDENTITY_TEXTS, input.repetitionIndex ?? 0)
      };
    case "GIVE_EARNINGS": {
      const text = variantFor(EARNINGS_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "GIVE_AGE_POLICY":
      // Requisito de edad: SIEMPRE determinista y SIEMPRE el mismo (invariante 2): ni redactor ni
      // variantes — la firmeza idéntica es deliberada.
      return { directiveType: directive.type, deterministicText: AGE_POLICY_TEXT, fallbackText: AGE_POLICY_TEXT };
    case "CLOSE_SOFT": {
      const text = variantFor(CLOSE_SOFT_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "CLOSE_RESCHEDULE": {
      const text = variantFor(CLOSE_RESCHEDULE_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "CLOSE_UNDERAGE": {
      const text = variantFor(CLOSE_UNDERAGE_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "DEFEND_SHARE":
      return { directiveType: directive.type, deterministicText: DEFEND_SHARE_TEXT, fallbackText: DEFEND_SHARE_TEXT };
    case "ASK_REPEAT": {
      const text = variantFor(ASK_REPEAT_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "SAY_GOODBYE": {
      const goodbye = directive.afterClose === "CLOSE_SOFT" ? GOODBYE_AFTER_DECLINE_TEXT : GOODBYE_TEXT;
      return { directiveType: directive.type, deterministicText: goodbye, fallbackText: goodbye };
    }
    case "STAY_SILENT":
      // Anti-loro: turno sin habla. Texto vacío EXPLÍCITO (no cae al guion de etapa por el default).
      return { directiveType: directive.type, deterministicText: "", fallbackText: "" };
    case "GIVE_SHARE_FIGURE": {
      // Re-decir la cifra AUTORIZADA vigente (respuesta reactiva a "¿cuánto os lleváis?" — invariante 3:
      // preguntada la cifra, se dice; la oferta viene del director/callNegotiation, jamás del LLM). Con
      // variante por repetición (mismas cifras, otra formulación) para no sonar a contestador.
      const offer = directive.shareOffer;
      const text = offer
        ? variantFor(
            [
              `Claro, te lo digo exacto: un ${offer.modelShare}% para ti y un ${offer.agencyShare}% para la agencia. Y el dinero lo cobras tú primero en tu cuenta y luego nos pasas nuestra parte, ¿vale?`,
              `Que sí, tranquila, te lo repito: ${offer.modelShare}% para ti, ${offer.agencyShare}% para la agencia. Y cobras tú primero, ¿vale?`
            ],
            input.repetitionIndex ?? 0
          )
        : variantFor(DEFER_TEXTS, input.repetitionIndex ?? 0);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "REPEAT_LAST_UTTERANCE": {
      // Ella no lo oyó: se repite lo último que dijo el bot. El prefijo se RECORTA si ya venía de una
      // repetición anterior (sin "Sí, te decía: Sí, te decía: ..." — riesgo del revisor jul-2026) y
      // también la muletilla de arranque ("Vale... "); el eco viene del transcript que reporta la
      // PLATAFORMA (fuente externa): se re-valida antes de decirlo — si no pasa, frase neutra.
      const RETRY_FALLBACK = "Nada, te estaba contando cómo trabajamos. ¿Sigo?";
      let last = input.lastBotUtterance?.trim() ?? "";
      while (last.startsWith(REPEAT_PREFIX)) last = last.slice(REPEAT_PREFIX.length).trim();
      last = stripSpokenPrefixes(last);
      const safeToEcho = last.length > 0 && validateCallUtterance(last).valid;
      const echo = safeToEcho ? `${REPEAT_PREFIX}${last}` : RETRY_FALLBACK;
      // "Repíteme LO DE X" (3-jul, llamada real): si pidió una PARTE concreta, el redactor repite SOLO esa
      // parte más despacio y simple (fallback: el eco completo). Sin tema -> eco determinista de siempre.
      const topic = repeatTopicFrom(input.utterance);
      if (topic && safeToEcho) {
        return {
          directiveType: directive.type,
          draftingBrief: {
            instruction: `No oyó bien la parte sobre "${topic}" de tu última frase. Repite SOLO esa parte, más despacio y con palabras sencillas, sin añadir datos nuevos ni temas que no estén en ella.`,
            groundingFacts: [`Tu última frase fue: "${last}"`],
            prohibitedClaims: ["Añadir datos, cifras o temas que no estén en la última frase"],
            mandatoryNuances: [],
            referenceInstagram: false,
            context: input.context,
            ...briefExtras(input)
          },
          fallbackText: echo
        };
      }
      return { directiveType: directive.type, deterministicText: echo, fallbackText: echo };
    }
    case "CLARIFY_LAST_UTTERANCE": {
      // No entendió una PALABRA/parte de lo que el bot acaba de decir (3-jul: "¿qué significa se
      // liquida?" / "¿límite de qué?" acababan en "mi socio"). El redactor lo explica en SIMPLE,
      // reformulando SOLO lo ya dicho + los hechos aprobados de la etapa; jamás datos nuevos.
      const gathered = gatherKnowledge(input.knowledge);
      const last = stripSpokenPrefixes(input.lastBotUtterance?.trim() ?? "");
      const clarifyFallback =
        last.length > 0 && validateCallUtterance(last).valid
          ? `O sea, te lo digo más fácil: ${last}`
          : variantFor(REASSURE_FALLBACK_TEXTS, input.repetitionIndex ?? 0);
      return {
        directiveType: directive.type,
        draftingBrief: {
          instruction:
            "No ha entendido una palabra o parte de LO QUE ACABAS DE DECIR (su pregunta la tienes en 'ella acaba de decir'). Explícaselo con palabras muy sencillas y cercanas, reformulando solo tu última frase y apoyándote en los hechos aprobados. Nada de tecnicismos, nada de datos nuevos. Remata con una comprobación corta ('¿mejor así?')." +
            repeatHint(input),
          groundingFacts: [...(last ? [`Tu última frase fue: "${last}"`] : []), ...gathered.points],
          prohibitedClaims: [
            ...gathered.prohibited,
            "Añadir datos, cifras o promesas que no estén en los hechos",
            "Deferir a 'mi socio' o a WhatsApp una palabra que tú mismo usaste"
          ],
          mandatoryNuances: gathered.nuances,
          referenceInstagram: false,
          context: input.context,
          ...briefExtras(input)
        },
        fallbackText: clarifyFallback
      };
    }
    case "CONCEDE_SHARE": {
      const text = concedeShareText(directive.shareOffer);
      return { directiveType: directive.type, deterministicText: text, fallbackText: text };
    }
    case "ANSWER_FROM_KNOWLEDGE":
      return planFromKnowledge(directive.type, input, {
        instruction:
          "Responde a su pregunta de forma directa, breve y cercana, apoyándote solo en estos hechos." + repeatHint(input),
        referenceInstagram: false,
        emptyFallback: variantFor(DEFER_TEXTS, input.repetitionIndex ?? 0)
      });
    case "REASSURE":
      return planFromKnowledge(directive.type, input, {
        instruction:
          "Tranquiliza su desconfianza con cercanía y naturalidad, sin presionar, y retoma la conversación." + repeatHint(input),
        referenceInstagram: false,
        emptyFallback: variantFor(REASSURE_FALLBACK_TEXTS, input.repetitionIndex ?? 0)
      });
    case "COVER_STAGE":
    default:
      return planCoverStage(input);
  }
}

/**
 * Campos "conversacionales" del brief (jul-2026): lo último que dijo ella, los temas tratados/pendientes
 * y los hechos que ya contó en la llamada. Dan al redactor lo que necesita para "responder primero y
 * reconducir después" sin tocar el flujo (el orden y la decisión siguen siendo del director).
 */
function briefExtras(
  input: PlanCallUtteranceInput
): Pick<CallDraftingBrief, "candidateUtterance" | "coveredTopics" | "pendingTopics" | "callFacts"> {
  // Saneo defensivo (R2 jul-2026): la cita entra a un PROMPT — se colapsan saltos de línea (que no
  // "rompan" la estructura del prompt) y se acota a 200 chars (una frase de voz real; menos superficie
  // de inyección). El validador + fallback siguen detrás de todo.
  const utterance = input.utterance?.replace(/\s+/g, " ").trim().slice(0, 200);
  return {
    candidateUtterance: utterance && utterance.length > 0 ? utterance : undefined,
    coveredTopics: input.coveredTopics?.length ? input.coveredTopics : undefined,
    pendingTopics: input.pendingTopics?.length ? input.pendingTopics : undefined,
    callFacts: input.callFacts?.length ? input.callFacts : undefined
  };
}

function concedeShareText(offer?: CallRevenueShareOffer): string {
  if (!offer) {
    // No debería ocurrir; ante la duda, deferimos en vez de inventar una cifra.
    return DEFER_TEXT;
  }
  const base = `Te entiendo. Mira, por ti lo podemos dejar en un ${offer.modelShare}% para ti y un ${offer.agencyShare}% para nosotros`;
  return offer.isFloor ? `${base}, y de ahí ya no podemos bajar más, ¿vale?` : `${base}, ¿qué te parece?`;
}

function planCoverStage(input: PlanCallUtteranceInput): CallUtterancePlan {
  const stageId = input.directive.stageId ?? "HOW_AGENCY_WORKS";
  const stage = callAgendaStage(stageId);
  const gathered = gatherKnowledge(input.knowledge);
  // Alex (jun-2026): NO referenciar "como te dije por Instagram" para el %, porque el % casi nunca se
  // menciona en el DM. Se presenta FRESCO en la llamada. (Futuro: condicionar a que el contexto del DM
  // confirme que ella preguntó la cifra exacta.)
  const referenceInstagram = false;

  // MONEY (jul-2026, llamada real de Alex): el conocimiento del DM llega SIN la cifra (gating de
  // sensibles) y el redactor "bailaba" alrededor del dinero sin decir el 70/30 e incluso prometia
  // "te lo explico en la llamada" (¡ya ESTABA en la llamada!). La cifra AUTORIZADA de la directiva
  // (callNegotiation) se inyecta como hecho, y la instruccion exige decirla claro.
  const isMoney = stageId === "MONEY" && input.directive.shareOffer;
  const offer = input.directive.shareOffer;
  const groundingFacts =
    isMoney && offer
      ? [
          `El reparto es un ${offer.modelShare}% para ti y un ${offer.agencyShare}% para la agencia.`,
          "El dinero lo cobras tú directamente en tu cuenta y luego nos pasas nuestra parte: pasa primero por ti.",
          // Lenguaje CLARO (Alex 3-jul, misma regla que el DM del 22-jun): "cobras", NUNCA "se liquida"
          // (jerga que la hizo preguntar y acabó en el absurdo "te lo confirmo por WhatsApp").
          "Cobras cada 14 días.",
          ...gathered.points
        ]
      : gathered.points;

  // TRANSICIONES (3-jul, feedback de Alex en la llamada real): al arrancar el primer tema se ENMARCA
  // ("pues mira, primero te cuento cómo trabajamos...") y al cambiar de tema se ANUNCIA con una
  // transición corta y natural — sin sonar a índice ni a lista. Solo naturalidad: el orden es del director.
  const transitionHint =
    (input.coveredTopics?.length ?? 0) > 0
      ? ` ESTÁS CAMBIANDO DE TEMA a "${stage.label}": arranca con una transición corta y natural que lo anuncie (p. ej. "vale, y ahora ${stage.label.toLowerCase()}"), sin sonar a lista.`
      : ' Es el PRIMER tema tras el saludo: enmárcalo con una frase corta antes de entrar (p. ej. "pues mira, primero te cuento cómo trabajamos").';

  const brief: CallDraftingBrief = {
    instruction:
      (isMoney
        ? "Presenta el reparto diciendo LA CIFRA EXACTA de los hechos (el porcentaje para ella y para la agencia), claro y sin rodeos, con la tranquilidad de que el dinero lo cobra ella primero. Remata preguntando qué le parece."
        : stage.objective) + transitionHint,
    groundingFacts,
    prohibitedClaims: isMoney
      ? [
          ...gathered.prohibited,
          "Aplazar la cifra ('luego te lo explico', 'te lo cuento en la llamada'): la cifra se dice AHORA.",
          "Decir 'se liquida' o 'liquidación' (jerga que no entiende): di siempre 'cobras cada 14 días'."
        ]
      : gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram,
    context: input.context,
    ...briefExtras(input)
  };

  return {
    directiveType: "COVER_STAGE",
    draftingBrief: brief,
    fallbackText: stageFallbackText(stageId, gathered.points, input.directive.shareOffer)
  };
}

function planFromKnowledge(
  directiveType: CallDirective["type"],
  input: PlanCallUtteranceInput,
  opts: { instruction: string; referenceInstagram: boolean; emptyFallback: string }
): CallUtterancePlan {
  const gathered = gatherKnowledge(input.knowledge);
  const brief: CallDraftingBrief = {
    instruction: opts.instruction,
    groundingFacts: gathered.points,
    prohibitedClaims: gathered.prohibited,
    mandatoryNuances: gathered.nuances,
    referenceInstagram: opts.referenceInstagram,
    context: input.context,
    ...briefExtras(input)
  };
  const fallbackText = gathered.points.length > 0 ? gathered.points.slice(0, 2).join(" ") : opts.emptyFallback;
  return { directiveType, draftingBrief: brief, fallbackText };
}

function gatherKnowledge(entries: KnowledgeEntry[] = []): {
  points: string[];
  prohibited: string[];
  nuances: string[];
} {
  const points: string[] = [];
  const prohibited: string[] = [];
  const nuances: string[] = [];
  for (const entry of entries) {
    points.push(...entry.approvedAnswerPoints);
    prohibited.push(...entry.prohibitedClaims);
    nuances.push(...entry.mandatoryNuances);
  }
  return { points: dedupe(points), prohibited: dedupe(prohibited), nuances: dedupe(nuances) };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

/**
 * Fallback determinista por etapa. Las afirmaciones de negocio salen del conocimiento aprobado (`points`);
 * solo el pegamento conversacional (saludo, encuadre, pregunta de límites) es guion fijo. En MONEY, la
 * cifra sale de la oferta autorizada (callNegotiation), no de texto libre.
 */
function stageFallbackText(stageId: CallAgendaStageId, points: string[], shareOffer?: CallRevenueShareOffer): string {
  if (stageId === "MONEY") {
    // Cifra exacta de la oferta autorizada + "%" (los TTS lo leen "por ciento"). FRESCA, sin referenciar el DM.
    if (shareOffer) {
      return `Y el dinero, que es lo importante: el reparto es un ${shareOffer.modelShare}% para ti y un ${shareOffer.agencyShare}% para la agencia. Y tranquila, que el dinero lo cobras tú directamente en tu cuenta y luego nos pasas nuestra parte, así siempre pasa primero por ti. Cobras cada 14 días. ¿Qué te parece?`;
    }
    // Sin oferta autorizada NO inventamos ni referenciamos el DM (no deberia ocurrir: el director siempre la pasa).
    return points[0] ?? DEFER_TEXT;
  }

  // Guion propio de la llamada (la voz de Alex). Si una etapa no lo tiene, cae a los puntos aprobados del
  // conocimiento y, en último caso, a deferir (nunca un puente vacío que suene a dar largas).
  return (
    CALL_SCRIPT[stageId] ||
    points.slice(0, 2).join(" ") ||
    "Ese detalle prefiero que te lo confirme bien mi socio, para no decirte nada inexacto."
  );
}
