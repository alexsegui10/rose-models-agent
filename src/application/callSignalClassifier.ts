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

// SEGURIDAD: la candidata declara ser MENOR de edad -> corte seguro (invariante 2 en la voz). Cubre
// "soy menor", "no tengo 18", edades 14-17 en cifra o palabra ("tengo 16", "tengo dieciseis", "16 anos").
// Excluye sustantivos que NO son edad ("16 seguidores/fotos/...") para no cortar a una adulta por error.
const UNDERAGE =
  /\b(soy|aun soy|todavia soy)\s+menor\b|\bmenor de edad\b|\b(no tengo|aun no tengo|todavia no tengo)\s+(los\s+)?(18|dieciocho)\b|\btengo\s+(1[0-7]|catorce|quince|dieciseis|diecisiete)\b(?!\s*(seguidor|foto|video|mensaj|euro|hij|gat|perr|ano luz))|\b(1[0-7]|catorce|quince|dieciseis|diecisiete)\s*an(os|itos)\b/;

// Agresión / sospecha GRAVE (assertive): insultos o acusaciones directas -> handoff. Cubre tuteo
// peninsular y 3a persona LATAM (son/están). NO incluye formas "preocupadas" ("¿no será estafa?": eso es
// distrust), que se evalúa después.
const HOSTILE =
  /\b(idiota|imbecil|gilipoll\w*|subnormal|cabron|cabrona|payas[oa]|capull\w*|sinverguenza|chorizos?|estafador\w*|timador\w*)\b|(una|que|vaya|menuda|de) mierda|me jode\b|no me jodas|vete a (la mierda|tomar)|(?<!\bsi )(es una|menuda|vaya|menudo) (estafa|timo|fraude|robo|porqueria|verguenza|tomadura de pelo)|(estafa|timo|fraude) de mierda|huele a (estafa|timo|fraude)|(?<!\bsi )(esto|eso) es (una )?(estafa|timo|fraude|ilegal|porqueria|tomadura de pelo)|(sois|son) unos? (estafadores|ladrones|mentirosos|sinverguenzas|rateros|tramposos|chorizos)|(me|nos) (estais|estan) (enganando|timando|estafando|tomando el pelo)|os voy a denunciar|voy a (denunciar|llamar a la policia|llamar a la guardia)|esto es ilegal|hijo de|callate|dejate de (gilipolleces|tonterias|chorradas|cuentos|historias|milongas)/;

// Pide hablar con una persona / rechaza la máquina -> handoff. Enfoque por INTENCIÓN (no plantillas
// rígidas): un REFERENTE humano + un VERBO de "ponme con / que me lo explique / comunícame", o un rechazo
// explícito a la máquina. Cubre fraseos naturales y LATAM ("platicar", "me comunican con el responsable").
const HUMAN_REF =
  /\b(?:una persona|persona real|alguien|un humano|una humana|el responsable|la responsable|un responsable|el encargado|la encargada|un encargado|un agente|el señor alex|alex|el jefe|la jefa|tu jefe|el dueno|la duena)\b/;
const WANT_HUMAN_VERB =
  /\b(?:hablar con|hablarlo con|platicar con|que me (?:lo )?explique|que me (?:lo )?cuente|que me atienda|que me llame|que se ponga|que me comunique|que me comuniquen|me comunican con|me comunica con|comunicar con|comunicarme con|me pase con|pasame con|paseme con|ponme con|me pasas con|me puede atender|puede atenderme)\b/;
const REJECT_MACHINE =
  /(?:no quiero|prefiero no|no me gusta|deja de|dejate de) (?:hablar con |que me hable )?(?:un |una )?(?:bot|maquina|robot|grabacion|contestador|inteligencia)\b|no me hables tu|\bme regala (?:un|el) (?:numero|telefono)\b/;

// Términos de reparto/dinero (para la queja del %). Cubre 2a y 3a persona. Incluye las cifras de la escalera
// (70/65/60/35/40) para que "70 es mucho" / "solo un 30 para mi" cuenten como queja del reparto.
const SHARE_TERMS =
  /(\b(30|35|40|60|65|70)\b|treinta|treinta y cinco|cuarenta|sesenta|sesenta y cinco|setenta|comision|reparto|porcentaje|quedais|quedan|os queda|se queda|os llevais|se llevan|se lleva|os quedais|quedaros|quedarse|para la agencia|para vosotros|para ustedes|me queda(is)?|vuestra parte|su parte)/;
// Términos de queja completos (con el término de reparto, basta uno de cada).
const COMPLAINT_TERMS =
  /(mucho|demasiad[oa]|car[oa]|carisim|abusiv|es un robo|un robo|injust|no es justo|muy poco|poco para mi|\bpoc[oa]\b|poquit|bajad|bajar|bajais|bajarlo|podeis bajar|reducir|menos|no me sale|no me compensa|no me convence|no me cuadra|no me parece justo|es un palo|un disparate|barbarid|excesiv|exager|un monton|monton)/;
// Queja de SEGUIMIENTO en negociación: SOLO frases dirigidas al dinero (no términos sueltos como
// "mucho"/"reducir" que podrían referirse al contenido/ritmo y regalarían un escalón sin queja real).
const FOLLOWUP_SHARE_COMPLAINT =
  /\bbaj[ae]\w*|\bpodeis bajar\b|\bsubirlo\b|\bsubir (?:un poco|algo|mas|mi parte)\b|no hay manera de subir|\bno me compensa\b|\bno me sale a cuenta\b|sigue siendo (?:muy )?(?:mucho|demasiad[oa]|car[oa]|alto|injusto|abusivo|un robo|un pico|poc[oa]|poquit[oa])|(?:es |hay )?mucha comision|demasiada comision|un poco menos|algo menos|me (?:quedo|queda|llevo|sigue quedando) (?:con )?(?:muy )?(?:poc\w*|poquit\w*)|\bno me hago\b|necesito mas (?:plata|dinero)|\bes un pico\b|\bes harto\b|me parece (?:mucho|demasiad[oa]|car[oa]|abusivo|injusto|un robo|un monton)|(?:es|son|me parece) (?:mucho|demasiad[oa]|bastante|un monton) para (?:vosotros|ustedes|la agencia|vos)|os llevais (?:mucho|demasiad[oa]|bastante|un monton)|es bastante para|(?:otra agencia|mi agencia|la otra)[^,.!?]{0,25}(?:mejor|me dejan|me dan|me quedo con|el \d{2})|me dejan (?:el |un )?\d{2}\b|quiero (?:algo )?mas para mi|mas para mi(?: parte)?|me gustaria (?:quedarme )?(?:con )?mas|mitad y mitad|\b50\s*\/?\s*50\b|\b50\s*y\s*50\b|el (?:50|cincuenta)(?:\s*por\s*ciento)?\b|\bo nada\b|deberia ser (?:mas|50|mitad)/;

// Desconfianza LEVE (worried) -> tranquilizar y seguir. Incluye sospecha HIPOTÉTICA ("y si es una
// estafa?"), que NO es agresión: por eso HOSTILE excluye las formas precedidas de "si".
const DISTRUST =
  /como se que\b|como se si\b|no me fio|me cuesta (creer|fiarme)|no me lo creo|(sera|no sera|sera esto) (una )?(estafa|timo|broma|mentira|verdad)|si (es|fuera|fuese|seria|esto es) (una )?(estafa|timo|fraude|mentira|engano)|y si me (estafan|enganan|timan|roban)|(esto es|es esto|esto sera) (real|seguro|legal|de verdad|fiable|verdad)|es (de )?fiar|me da (un poco de )?(cosa|miedo|reparo|cosica|repelus|no se que)|da (un poco de )?miedo|desconfi|no se si (fiarme|me fio|es verdad|esto es real)|(seguro que|de verdad) (es legal|me vais a pagar|esto funciona)|no (me )?(van|vais|vayais) a (pagar|estafar|enganar)|y si es mentira/;

// Sospecha HIPOTÉTICA ("y si esto es una estafa?", "y si esto fuera un timo"): NO es agresión, es duda
// -> tranquilizar. Se evalúa ANTES que HOSTILE porque "si esto es una estafa" contiene "es una estafa",
// que HOSTILE marcaría como acusación directa (el guard `si` no alcanza al haber "esto" en medio). La
// coma de "sí, esto es una estafa" (afirmación) no entra: exige whitespace tras "si" y misma cláusula.
const HYPOTHETICAL_SUSPICION =
  /\bsi\s+(?:esto|eso|es|fuera|fuese|seria)\b[^,.!?]{0,25}\b(?:estafa|timo|fraude|mentira|engano|robo|ilegal)\b/;

// Quiere PENSARLO / consultarlo (no es desinterés ni ruido): cierre cálido, sin contrato, puerta abierta.
// Exige un verbo de deliberación (tengo que / voy a / necesito / dejame...) antes de pensar/mirar/consultar
// para no confundir "pienso que esta bien" (opinión, asentimiento) con "me lo tengo que pensar" (duda).
const WANTS_TO_THINK =
  /\b(?:tengo que|me lo tengo que|voy a|me lo voy a|necesito|quiero|deja(?:me)?(?: que)?|dame tiempo (?:para|de)|necesito tiempo (?:para|de))\s+(?:lo\s+|me lo\s+)?(?:pensar\w*|piense\w*|consultar\w*)\b|\bme lo pienso\b|\blo (?:consulto|hablo) con (?:mi|mis|el|la)\s+(?:pareja|marido|novi[oa]|familia|madre|hermana|chic[oa])\b/;

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

// Muletillas de "continúa" ("¿y?", "¿y qué más?", "sigue", "cuenta", "y luego"): NO son preguntas a
// deferir, son "dale, avanza". Se evalúan ANTES que QUESTION para que no se interpreten como duda.
const CONTINUATION =
  /^¿?\s*y\s*\??$|^¿?\s*y\s+que(\s+mas|\s+es)?\s*\??$|^¿?\s*que\s+mas\s*\??$|\by\s+(luego|despues|que\s+mas)\b|\bsigue\b|\bcontinua\b|\bcuentame\b/;

// Pregunta de IDENTIDAD ("¿quién eres?", "¿de dónde llamas?", "¿de qué agencia?", "¿cómo te llamas?"): NO se
// defiere; el bot dice quién es. Se evalúa ANTES que QUESTION (que también capturaría "quién").
const ASKS_IDENTITY =
  /\bquien (eres|es|habla|sois|son|me llama|llama)\b|\bde donde (llamas|llamais|me llamas|es esto|sois|llaman)\b|\bde que (agencia|empresa|parte)\b|\bpara quien (trabajas|trabajais|es esto)\b|\bque agencia\b|\bcomo te llamas\b|\bde parte de quien\b/;

// Saludo de apertura ("hola", "buenas", "hola qué tal"): la candidata devuelve el saludo -> asentir y
// seguir; no tratarlo como ruido ni (por el "qué tal") como pregunta. Se evalúa ANTES que QUESTION.
const GREETING = /^\s*(hola+|buenas|buenos dias|buenas tardes|hey|holi|que tal|como estas|como andas|como va)\b/;

// ¿Es una pregunta?
const QUESTION =
  /\?\s*$|\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|porque|quien|para que)\b|(me puedes|puedes|podrias|podeis|me podeis|sabes|sabeis) (decir|explicar|contar|aclarar|mandar|ensenar|saber|si)|(tengo|una|otra) (duda|pregunta)/;

// Afirmaciones / asentimiento -> avanzar (con relleno inicial opcional).
const FOLLOWS_ALONG =
  /^\s*(ah+|ahh|pues|bueno)?\s*(vale|oka?y?|okis|si+|claro|perfecto|genial|de acuerdo|entiend\w*|aja+|aha+|ajam+|ajan+|mjm+|ahem|ujum+|ya|correcto|bien|guay|venga|estupendo|fenomenal|por supuesto|sip|dale|va)\b|me parece (bien|genial|perfecto)|suena bien|me gusta|adelante|cuentame|dime|sigue|esta bien|me vale/;

/** Clasifica lo dicho por la candidata en una señal para el director. */
export function classifyCallSignal(input: CallSignalInput): CallCandidateSignal {
  const text = normalize(input.utterance ?? "");
  if (text.length === 0) {
    // Silencio / turno vacío: no se asume asentimiento, se pide que lo repita.
    return "unclear";
  }

  // Orden de prioridad: lo más urgente/seguro primero.
  // SEGURIDAD primero: si declara ser menor de edad, corte seguro (invariante 2), por encima de todo.
  if (UNDERAGE.test(text)) return "underage";
  // Sospecha hipotética ("y si esto es una estafa?") -> tranquilizar, va ANTES de HOSTILE (ver arriba).
  if (HYPOTHETICAL_SUSPICION.test(text)) return "distrust";
  if (HOSTILE.test(text)) return "hostile-or-suspicious";
  if ((HUMAN_REF.test(text) && WANT_HUMAN_VERB.test(text)) || REJECT_MACHINE.test(text)) return "wants-human";
  if (SHARE_TERMS.test(text) && COMPLAINT_TERMS.test(text)) return "complains-about-share";
  // Queja de seguimiento durante la negociación (frase dirigida al dinero, sin repetir "reparto").
  if (input.moneyContext && FOLLOWUP_SHARE_COMPLAINT.test(text)) return "complains-about-share";
  if (DISTRUST.test(text)) return "distrust";
  if (WANTS_TO_THINK.test(text)) return "wants-to-think";
  if (NOT_INTERESTED.test(text)) return "not-interested";
  if (WANTS_TO_END.test(text)) return "wants-to-end";
  if (CONFORMITY.test(text)) return "follows-along";
  if (CONTINUATION.test(text)) return "follows-along";
  if (ASKS_IDENTITY.test(text)) return "asks-identity";
  if (GREETING.test(text)) return "follows-along";
  if (QUESTION.test(text)) return input.isCoveredQuestion ? "asks-covered" : "asks-unknown";
  if (FOLLOWS_ALONG.test(text)) return "follows-along";

  // No reconocido (ruido/STT roto / frase no contemplada): se pide que lo repita en vez de asumir un "sí".
  return "unclear";
}
