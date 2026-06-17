/**
 * "Oído" del bot de llamada: convierte lo que dijo la candidata (texto de STT) en una señal
 * (`CallCandidateSignal`) que consume el director. Es DETERMINISTA y por patrones (castellano + LATAM
 * porque hay candidatas de allí): rápido y sin LLM, lo que importa en una llamada en vivo.
 *
 * Decisiones de diseño:
 *  - La distinción pregunta CUBIERTA vs DESCONOCIDA NO la hace el patrón (sería frágil): el cerebro corre
 *    el recuperador de conocimiento y pasa `isCoveredQuestion`. Si es pregunta y no se sabe, se DEFIERE
 *    a Alex ("mi socio"), nunca se improvisa (por eso el defecto seguro es asks-unknown).
 *  - Distingue desconfianza LEVE (worried -> tranquilizar) de agresión/sospecha GRAVE (assertive ->
 *    handoff): "¿no será una estafa?" es distrust; "esto es una estafa, sois unos ladrones" es hostil.
 *  - Quejas del reparto "pegajosas por contexto": durante la negociación (`moneyContext`), una queja sin
 *    repetir la palabra reparto ("sigue siendo mucho", "bajadlo") cuenta igual como queja, para que la
 *    escalera 70->65->60 no se rompa cuando la candidata solo insiste.
 *  - Es best-effort y SUSTITUIBLE: el contrato con el director (la señal) es estable, así que más
 *    adelante se puede anteponer una capa LLM con fallback a esta sin tocar el director.
 *
 * Invariante 1: esto solo CLASIFICA; la decisión (qué hace el bot) la toma el director con la señal.
 */

import type { CallCandidateSignal } from "./callDirector";

export interface CallSignalInput {
  /** Lo último que dijo la candidata (texto de STT). */
  utterance: string;
  /**
   * Solo relevante cuando la frase es una PREGUNTA: ¿el conocimiento de negocio la cubre? Lo decide el
   * cerebro con el recuperador. Por defecto false → se defiere a Alex (nunca se improvisa una respuesta).
   */
  isCoveredQuestion?: boolean;
  /**
   * ¿Estamos en contexto de dinero/negociación (ya se presentó el reparto)? Si es true, una queja que no
   * repita la palabra "reparto/comisión/30" igualmente cuenta como complains-about-share (insistencia).
   */
  moneyContext?: boolean;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Agresión / sospecha GRAVE (assertive): insultos o acusaciones directas -> handoff. Cubre tuteo
// peninsular y 3a persona LATAM (son/están). NO incluye formas "preocupadas" ("¿no será estafa?": eso es
// distrust), que se evalúa después.
const HOSTILE =
  /\b(idiota|imbecil|gilipoll\w*|subnormal|cabron|cabrona|payas[oa]|capull\w*|sinverguenza|chorizos?|estafador\w*|timador\w*)\b|(una|que|vaya|menuda|de) mierda|me jode\b|no me jodas|vete a (la mierda|tomar)|(?<!\bsi )(es una|menuda|vaya|menudo) (estafa|timo|fraude|robo|porqueria|verguenza|tomadura de pelo)|(estafa|timo|fraude) de mierda|huele a (estafa|timo|fraude)|(?<!\bsi )(esto|eso) es (una )?(estafa|timo|fraude|ilegal|porqueria|tomadura de pelo)|(sois|son) unos? (estafadores|ladrones|mentirosos|sinverguenzas|rateros|tramposos|chorizos)|(me|nos) (estais|estan) (enganando|timando|estafando|tomando el pelo)|os voy a denunciar|voy a (denunciar|llamar a la policia|llamar a la guardia)|esto es ilegal|hijo de|callate|dejate de (gilipolleces|tonterias|chorradas|cuentos|historias|milongas)/;

// Pide hablar con una persona / rechaza la máquina -> handoff. Cubre fraseos naturales y LATAM.
const WANTS_HUMAN =
  /(hablar|hablo|hable|hablamos|hablarlo) con (una persona|persona real|alguien|un humano|una humana|el responsable|un responsable|la responsable|el encargado|un encargado|un agente|alex|el jefe|la jefa|tu jefe|el dueno|la duena)|que (me atienda|me llame|se ponga|hable conmigo|me lo explique|me lo cuente|me comunique con|me comuniquen con) (una persona|alguien|un humano|una humana|el responsable|un responsable|alex|el jefe)|(me puede atender|puede atenderme|que me atienda) (una persona|alguien|un humano)|(pasame|paseme|pasenme|ponme|me pasas|comunicame|comuniqueme) con (alex|una persona|alguien|un humano|el jefe|el responsable)|(quiero|necesito|prefiero|me gustaria) (hablar con|que me llame|que me atienda|que me lo explique|que se ponga|que me comunique con) (una persona|alguien|un humano|alex|el responsable|el jefe)|(no quiero|prefiero no|no me gusta) hablar con (un |una )?(bot|maquina|robot|grabacion|contestador|inteligencia)|no me hables tu|que se ponga (alguien|una persona|un humano|alex)/;

// Términos de reparto/dinero (para la queja del %). Cubre 2a y 3a persona.
const SHARE_TERMS =
  /(\b30\b|treinta|comision|reparto|porcentaje|quedais|quedan|os queda|se queda|os llevais|se llevan|se lleva|os quedais|quedaros|quedarse|para la agencia|para vosotros|para ustedes|me queda(is)?|vuestra parte|su parte)/;
// Términos de queja completos (con el término de reparto, basta uno de cada).
const COMPLAINT_TERMS =
  /(mucho|demasiad[oa]|car[oa]|carisim|abusiv|es un robo|un robo|injust|no es justo|muy poco|poco para mi|bajad|bajar|bajais|bajarlo|podeis bajar|reducir|menos|no me sale|no me compensa|no me convence|no me cuadra|no me parece justo|es un palo|un disparate|barbarid|excesiv|exager|un monton|monton)/;
// Queja de SEGUIMIENTO en negociación: SOLO frases dirigidas al dinero (no términos sueltos como
// "mucho"/"reducir" que podrían referirse al contenido/ritmo y regalarían un escalón sin queja real).
const FOLLOWUP_SHARE_COMPLAINT =
  /(bajad\w*|bajar\w*|bajal\w*|podeis bajar|baja(d|r) (un poco|algo|mas)|no me compensa|no me sale a cuenta|sigue siendo (mucho|demasiad[oa]|car[oa]|alto|injusto|abusivo|un robo)|(es |hay )?mucha comision|demasiada comision|un poco menos|algo menos|me (quedo|llevo) (con )?(muy )?poco)/;

// Desconfianza LEVE (worried) -> tranquilizar y seguir. Incluye sospecha HIPOTÉTICA ("y si es una
// estafa?"), que NO es agresión: por eso HOSTILE excluye las formas precedidas de "si".
const DISTRUST =
  /como se que\b|como se si\b|no me fio|me cuesta (creer|fiarme)|no me lo creo|(sera|no sera|sera esto) (una )?(estafa|timo|broma|mentira|verdad)|si (es|fuera|fuese|seria|esto es) (una )?(estafa|timo|fraude|mentira|engano)|y si me (estafan|enganan|timan|roban)|(esto es|es esto|esto sera) (real|seguro|legal|de verdad|fiable|verdad)|es (de )?fiar|me da (un poco de )?(cosa|miedo|reparo|cosica|repelus|no se que)|da (un poco de )?miedo|desconfi|no se si (fiarme|me fio|es verdad|esto es real)|(seguro que|de verdad) (es legal|me vais a pagar|esto funciona)|no (me )?(van|vais|vayais) a (pagar|estafar|enganar)|y si es mentira/;

// Desinterés -> cierre cálido sin presionar (NO se le manda contrato). Se evalúa antes que "quiere
// terminar" para no empujar el contrato a quien no le interesa.
const NOT_INTERESTED =
  /(no me interesa|no me interesan|no gracias|no, gracias|no quiero seguir|no me convence nada|mejor lo dejamos|paso de esto|no es para mi|no me llama|no quiero hacerlo|prefiero dejarlo|no me apetece)/;

// Quiere terminar / colgar -> cerrar con contrato.
const WANTS_TO_END =
  /(te dejo|te tengo que dejar|tengo que (irme|colgar|dejarlo|dejarte)|hablamos (luego|mas tarde|otro dia|en otro momento|manana)|ahora no puedo|no es buen momento|me tengo que ir|tengo prisa|me pillas (mal|liada)|adios|hasta luego|me voy|cuelgo)/;

// Conformidad que el detector de preguntas confundiría ("como tu digas"). Se evalúa ANTES que QUESTION.
const CONFORMITY =
  /(como tu (digas|veas|quieras)|como veas|lo que (tu )?(digas|veas|quieras|sea)|me parece que si|me da igual|tu mandas)/;

// ¿Es una pregunta?
const QUESTION =
  /\?\s*$|\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|porque|quien|para que)\b|(me puedes|puedes|podrias|podeis|me podeis|sabes|sabeis) (decir|explicar|contar|aclarar|mandar|ensenar|saber|si)|(tengo|una|otra) (duda|pregunta)/;

// Afirmaciones / asentimiento -> avanzar (con relleno inicial opcional).
const FOLLOWS_ALONG =
  /^\s*(ah+|ahh|pues|bueno)?\s*(vale|oka?y?|okis|si+|claro|perfecto|genial|de acuerdo|entiend\w*|aja+|aha+|ya|correcto|bien|guay|venga|estupendo|fenomenal|por supuesto|sip|dale|va)\b|me parece (bien|genial|perfecto)|suena bien|me gusta|adelante|cuentame|dime|sigue|esta bien|me vale/;

/** Clasifica lo dicho por la candidata en una señal para el director. */
export function classifyCallSignal(input: CallSignalInput): CallCandidateSignal {
  const text = normalize(input.utterance ?? "");
  if (text.length === 0) {
    // Silencio / turno vacío: no se asume asentimiento, se pide que lo repita.
    return "unclear";
  }

  // Orden de prioridad: lo más urgente/seguro primero.
  if (HOSTILE.test(text)) return "hostile-or-suspicious";
  if (WANTS_HUMAN.test(text)) return "wants-human";
  if (SHARE_TERMS.test(text) && COMPLAINT_TERMS.test(text)) return "complains-about-share";
  // Queja de seguimiento durante la negociación (frase dirigida al dinero, sin repetir "reparto").
  if (input.moneyContext && FOLLOWUP_SHARE_COMPLAINT.test(text)) return "complains-about-share";
  if (DISTRUST.test(text)) return "distrust";
  if (NOT_INTERESTED.test(text)) return "not-interested";
  if (WANTS_TO_END.test(text)) return "wants-to-end";
  if (CONFORMITY.test(text)) return "follows-along";
  if (QUESTION.test(text)) return input.isCoveredQuestion ? "asks-covered" : "asks-unknown";
  if (FOLLOWS_ALONG.test(text)) return "follows-along";

  // No reconocido (ruido/STT roto / frase no contemplada): se pide que lo repita en vez de asumir un "sí".
  return "unclear";
}
