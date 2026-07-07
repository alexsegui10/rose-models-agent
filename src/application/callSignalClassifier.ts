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
  /**
   * Lo ÚLTIMO que dijo el BOT (jul-2026, aclaraciones): "¿qué significa X?" solo es una ACLARACIÓN de lo
   * ya dicho si X aparece en el último enunciado del bot; si no, sigue el camino normal de preguntas.
   */
  lastBotUtterance?: string;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// SEGURIDAD: la candidata declara ser MENOR de edad -> corte seguro (invariante 2 en la voz). Cubre
// "soy menor", "no tengo 18", edades 14-17 en cifra o palabra ("tengo 16", "tengo dieciseis", "16 anos"),
// y la minoría declarada EN FUTURO ("voy a tener 18 en marzo", "cuando cumpla los 18", "me falta un año
// para los 18"): quien va a CUMPLIR 18 tiene 17 HOY (bloqueante B1 del revisor jul-2026 — antes caía en
// la política de edad y el pitch seguía). Excluye sustantivos que NO son edad ("16 seguidores/fotos/...").
const UNDERAGE =
  /\b(soy|aun soy|todavia soy)\s+menor\b|\bmenor de edad\b|\b(no tengo|aun no tengo|todavia no tengo)\s+(los\s+)?(18|dieciocho)\b|\btengo\s+(1[0-7]|catorce|quince|dieciseis|diecisiete)\b(?!\s*(seguidor|foto|video|mensaj|euro|hij|gat|perr|ano luz))|\b(1[0-7]|catorce|quince|dieciseis|diecisiete)\s*an(os|itos)\b|\bvoy a (?:tener|cumplir)\s+(?:los\s+)?(?:18|dieciocho)\b(?!\s*(?:seguidor|foto|video|mensaj|euro))|\bcuando\s+(?:tenga|cumpla)\s+(?:los\s+)?(?:18|dieciocho)\b(?!\s*(?:seguidor|foto|video|mensaj|euro))|\bme falta[n]?\s+[^.?!]{0,25}\bpara\s+(?:tener|cumplir|los)\s+(?:los\s+)?(?:18|dieciocho)\b|\bcumplo\s+(?:los\s+)?(?:18|dieciocho)\b/;

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
  /(no me interesa|no me interesan|no gracias|no, gracias|no quiero seguir|no me convence nada|mejor lo dejamos|paso de esto|paso,? gracias|no es para mi|no me llama|no quiero hacerlo|prefiero dejarlo|no me apetece)/;

// Quejas INEQUÍVOCAS del reparto que valen SIN contexto de dinero (no dependen de moneyContext ni de un
// término "30/70"): "mitad y mitad", "50/50", "quiero más para mí", "en otra agencia me dan el 50".
// Solo lo INEQUÍVOCO va sin contexto de dinero. "más para mí" se quitó de aquí (pillaba "más para mí GUSTO"
// y regalaba un escalón); ahora "más para mí" solo cuenta como queja dentro de FOLLOWUP (exige moneyContext).
// jul-2026 (llamada real de Alex): "¿por qué (solo el) 30 para mí?" / "¿por qué os lleváis el 70?" es un
// CUESTIONAMIENTO del reparto -> defensa del 70 (escalera), JAMÁS "lo hablo con mi socio" (quedaba absurdo).
const DIRECT_SHARE_COMPLAINT =
  /mitad y mitad|\b50\s*\/?\s*50\b|\b50\s*y\s*50\b|(?:otra agencia|la otra|otras agencias)[^,.!?]{0,30}(?:me dan|me dejan|dan el|el \d{2}|mejor|mas)|me (?:dan|dejan|ofrecen) el \d{2}|\bpor\s?que\b[^.?!]{0,25}\b(?:30|treinta|70|setenta)\b(?!\s*(?:fotos?|videos?|minutos?|dias?|anos?|seguidor|reels?))|\bpor\s?que\s+tan\s+poco\b/;

// Pregunta de INGRESOS ("¿cuánto se gana?", "¿cuánto voy a ganar?", "¿se gana bien?"): respuesta HONESTA
// (depende de ti, SIN cifras ni promesas), no se defiere. Se evalúa antes que QUESTION.
const ASKS_EARNINGS =
  /\bcuanto (?:se gana|gano|voy a ganar|ganaria|se saca|puedo ganar|ganan|dinero|sacaria|cobro|cobraria|cobrare|voy a cobrar|me llevo|me llevaria|se puede (?:ganar|sacar))\b|\bse gana bien\b|\bcuanto se gana al mes\b/;

// Quiere terminar / colgar -> cerrar con contrato. Incluye despedidas sueltas ("chau chau", "bye"):
// tras el cierre deben llevar a la despedida/silencio, no a repetir el discurso (barrido jul-2026).
const WANTS_TO_END =
  /(te dejo|te tengo que dejar|tengo que (irme|colgar|dejarlo|dejarte)|hablamos (luego|mas tarde|otro dia|en otro momento|manana)|ahora no puedo|no es buen momento|me tengo que ir|tengo prisa|me pillas (mal|liada)|adios|hasta luego|me voy|cuelgo|\bcha[ou]+\b|\bbye\b|\bnos vemos\b)/;

// Conformidad que el detector de preguntas confundiría ("como tu digas"). Se evalúa ANTES que QUESTION.
const CONFORMITY =
  /(como tu (digas|veas|quieras)|como veas|lo que (tu )?(digas|veas|quieras|sea)|me parece que si|me da igual|tu mandas)/;

// Muletillas de "continúa" ("¿y?", "¿y qué más?", "sigue", "cuenta", "y luego"): NO son preguntas a
// deferir, son "dale, avanza". Se evalúan ANTES que QUESTION para que no se interpreten como duda.
const CONTINUATION =
  /^¿?\s*y\s*\??$|^¿?\s*y\s+que(\s+mas|\s+es)?\s*\??$|^¿?\s*que\s+mas\s*\??$|\by\s+(luego|despues|que\s+mas)\b|\bsigue\b|\bcontinua\b|\bcuentame\b/;

// Pregunta de IDENTIDAD ("¿quién eres?", "¿de dónde llamas?", "¿de qué agencia?", "¿cómo te llamas?"): NO se
// defiere; el bot dice quién es. Incluye preguntas personales al bot ("¿cuántos años tienes?"): deferirlas a
// "mi socio" no tiene sentido (bug jul-2026); se responden con identidad/simpatía. El lookahead (?!\s+que)
// evita confundir "¿cuántos años tienes que tener?" (eso es política de edad). Se evalúa ANTES que QUESTION.
const ASKS_IDENTITY =
  /\bquien (eres|es|habla|sois|son|me llama|llama)\b|\bde donde (llamas|llamais|me llamas|es esto|sois|llaman|eres)\b|\bde que (agencia|empresa|parte)\b|\bpara quien (trabajas|trabajais|es esto)\b|\bque agencia\b|\bcomo te llamas\b|\bde parte de quien\b|\bcuantos anos (?:tienes|tenes|tiene usted)\b(?!\s+que)|\bque edad (?:tienes|tenes|tiene usted)\b(?!\s+que)/;

// Pregunta de POLÍTICA DE EDAD ("¿a partir de qué edad?", "¿hay edad mínima?", "¿qué edad hay que tener?"):
// se responde DETERMINISTA (solo mayores de 18, requisito innegociable), NUNCA se defiere a "mi socio"
// (bug jul-2026: deferir la edad quedaba absurdo). OJO: las declaraciones de minoría ("tengo 16") las caza
// UNDERAGE antes (prioridad de seguridad); esto son PREGUNTAS sobre el requisito.
const ASKS_AGE_POLICY =
  /\bedad minima\b|\bminimo de edad\b|\blimite de edad\b|\ba partir de (?:que edad|cuantos anos)\b|\b(?:que edad|cuantos anos) (?:hay que|hace falta|se necesita|necesito|tengo que|tienes que|se debe|debo) tener\b|\btener (?:los )?(?:18|dieciocho)\b|\bhay que ser mayor de edad\b|\bcon (?:18|dieciocho) (?:anos? )?(?:ya )?(?:puedo|se puede|vale)\b/;

// Declaración de edad ADULTA ("tengo 24", "24 años"): es información, no ruido -> asentir y seguir (el
// redactor la reconoce con naturalidad y el extractor de hechos la recuerda). Las edades 14-17 las caza
// UNDERAGE antes (seguridad). Excluye sustantivos que no son edad (igual que UNDERAGE).
const STATES_ADULT_AGE =
  /\btengo\s+(1[89]|[2-5]\d)\s*(anos|anitos)?\b(?!\s*(seguidor|foto|video|mensaj|euro|hij|gat|perr))|\b(1[89]|[2-5]\d)\s*an(os|itos)\b/;
// Pregunta SUSTANTIVA (con palabra interrogativa real). Distingue "tengo 24, ¿pasa algo?" (coletilla
// trivial -> es una declaración de edad, asentir) de "tengo 24, ¿cuánto cobraría?" (pregunta de verdad).
const SUBSTANTIVE_QUESTION = /\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|porque|quien|para que)\b/;

// Saludo de apertura ("hola", "buenas", "hola qué tal"): la candidata devuelve el saludo -> asentir y
// seguir; no tratarlo como ruido ni (por el "qué tal") como pregunta. Se evalúa ANTES que QUESTION.
// OJO: anclado a FIN de cadena para que sea SOLO un saludo. Si tras el saludo viene algo sustantivo
// ("buenas, ¿y el porcentaje?", "hola y cuánto se cobra"), NO es saludo -> lo coge QUESTION y se responde.
const GREETING =
  /^\s*(?:(?:hola+|muy buenas|buenas tardes|buenas noches|buenos dias|buenas|holi|hey|que tal todo|que tal|como estas|como andas|como va|todo bien|estas|guap[oa]|ti[oa]|wey)[\s,!¡.?]*)+$/;

// ¿Es una pregunta?
const QUESTION =
  /\?\s*$|\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|porque|quien|para que)\b|(me puedes|puedes|podrias|podeis|me podeis|sabes|sabeis) (decir|explicar|contar|aclarar|mandar|ensenar|saber|si)|(tengo|una|otra) (duda|pregunta)/;

// Afirmaciones / asentimiento -> avanzar. El prefijo tolera VARIAS coletillas encadenadas ("hola si",
// "mmm vale...", "eh bueno dale") — jul-2026, barrido de personas: "hola si" caía en unclear y el bot
// pedía repetir en el primer turno (sonaba a sordo).
const FOLLOWS_ALONG =
  /^\s*(?:(?:ah+|ahh|pues|bueno|hola+|buenas|holi|hey|oye|mira|mmm+|mm+|eh+|este|em+|uy|si\?)[\s,!¡.]*)*(vale|oka?y?|okis|si+|claro|perfecto|genial|de acuerdo|entiend\w*|aja+|aha+|ajam+|ajan+|mjm+|ahem|ujum+|ya|correcto|bien|guay|venga|estupendo|fenomenal|por supuesto|sip|dale|va)\b|me parece (bien|genial|perfecto)|suena bien|me gusta|adelante|cuentame|dime|sigue|esta bien|me vale/;

// Asentimiento a secas que ACABA en "?" (o sin el): "si?", "vale?", "ah si?", "claro?". Es un "si, dime", NO
// una pregunta. QUESTION lo confundia por el "?" final y el bot defieria algo inexistente a WhatsApp (bug del
// simulador de voz 7-jul: a un "si?" al descolgar solto "eso te lo confirmo por WhatsApp en cuanto colguemos").
// Anclado a FIN de cadena: "vale, pero cuanto gano?" NO entra aqui (esa SI es pregunta y la coge QUESTION).
const BARE_AFFIRMATION =
  /^\s*(?:(?:ah+|pues|bueno|si+|oye|mira|eh+|mmm+|mm+|holi|hey|hola+|buenas|uy)[\s,!¡.?]*)*(si+|vale|oka?y?|okis|claro|ya|dale|va|correcto|perfecto|genial|bien|guay|aja+|ajam+|sip|entiend\w*)[\s,!¡.?]*$/;

// Confirmación de identidad al descolgar ("sí, soy yo", "con ella habla", "la misma"): es un "sí, sigue",
// no ruido (jul-2026, barrido de personas: "hola si soy yo" acababa en "¿me lo repites?"). ANCLADA a la
// frase entera para que "lo hablo con ella" (consultar a alguien) no cuente como asentimiento.
const IDENTITY_CONFIRM =
  /^\s*(?:(?:hola+|buenas|alo+|si+|s[ií]\?|eh+|pues|bueno|dime|digame)[\s,¡!.?]*)*(?:soy yo|con ella hablas?|ella habla|habla con ella|la misma|yo misma|con ella habla)[\s,!.]*$/;

// Pregunta por la CIFRA del reparto ("¿cuánto os lleváis?", "¿el reparto cómo era?", "¿qué porcentaje?"):
// invariante 3 es REACTIVO — preguntada la cifra exacta, se responde la política autorizada (70/30 o el
// escalón vigente), JAMÁS se defiere (jul-2026, barrido: "¿cuánto os lleváis?" acababa en "te lo mando por
// WhatsApp", evasivo). Solo formas en 2ª/3ª persona (la agencia); "¿cuánto gano YO?" sigue siendo earnings.
const ASKS_SHARE_FIGURE =
  /\bcuanto (?:os|se|te) (?:llevais|llevas|lleva|llevan|quedais|quedas|queda|quedan|cobrais|cobran)\b|\bque (?:porcentaje|comision)\b|\bcomo (?:es|era|va|iba|funciona|queda) (?:el|lo del) reparto\b|\bel reparto como (?:es|era|va|iba|queda)\b|\bcual (?:es|era) (?:el|la) (?:reparto|porcentaje|comision)\b|\bcuanto (?:es|era) (?:el|la) (?:reparto|porcentaje|comision)\b/;

// Pregunta si es un ROBOT/IA ("¿eres un robot?", "¿hablo con una máquina?"): se responde con IDENTIDAD
// (soy Alex, el de Rose Models), sin afirmar ni negar ser humano (el validador veta "soy una persona").
// El RECHAZO a la máquina ("no quiero hablar con un robot") lo caza antes REJECT_MACHINE (wants-human).
const BOT_CHECK =
  /\beres (?:un |una )?(?:robot|bot|ia|maquina|inteligencia artificial|grabacion|contestador)\b|\bhablo con (?:un |una )?(?:robot|bot|maquina|ia|grabacion)\b|\beres (?:real|de verdad|una persona|humano|humana)\b|\bsos (?:un |una )?(?:robot|bot|ia|maquina)\b/;

// Pregunta PERSONAL/charla dirigida al bot ("¿estás soltero? jaja", "¿tú también tienes OnlyFans?",
// "¿qué hora es allí?"): se gestiona como IDENTIDAD (el brief ya manda salir del paso con humor, sin
// inventar datos) — jamás "lo hablo con mi socio" para una broma (barrido 3-jul).
const PERSONAL_TO_BOT =
  /\b(?:tu|vos) tambien\b[^.?!]{0,25}\b(?:onlyfans|of|fotos|contenido)\b|\bestas solter[oa]\b|\btienes (?:novia|novio|pareja)\b|\bque hora es (?:alli|alla|ahi|por alla|en espana|donde estas)\b|\bcomo estas tu\b|\by tu que tal\b|\bcuantos anos me das\b|\beres guap[oa]\b/;

// Pide que el BOT repita ("¿qué decías?", "no te escuché", "se corta, repite"): repetir lo último dicho,
// NUNCA deferir a WhatsApp ni pedirle a ELLA que repita (jul-2026, barrido: acababa en el absurdo
// "eso te lo confirmo por WhatsApp" cuando ella solo pedía que repitiera).
const ASKS_BOT_REPEAT =
  /\bque (?:decias|dijiste|has dicho|estabas diciendo|me contabas)\b|\bme lo (?:repites|puedes repetir|repetis|repite)\b|\brepite(?:melo|me)?\b|\bno te (?:escuche|escucho|oigo|oi|he oido|entendi bien)\b|\bse (?:corto|ha cortado|entrecorta|escucha entrecortado)\b|^\s*¿?\s*como\s*\??\s*$|^\s*¿?\s*que\s*\?+\s*$/;

// ACLARACIÓN de lo que el bot ACABA de decir (3-jul, llamada real de Alex: "¿qué significa se liquida?"
// y "¿límite de qué?" acababan en el absurdo "te lo confirmo por WhatsApp"). Dos formas:
//  - con TÉRMINO capturable ("¿qué significa X?", "¿X de qué?"): solo cuenta si X está en el último
//    enunciado del bot (si es un término nuevo, sigue el camino normal covered/unknown);
//  - sin término ("¿a qué te refieres?", "no lo entiendo", "¿cómo que?"): siempre es aclaración.
const CLARIFY_WITH_TERM = [
  /\bque (?:significa|quiere decir|quieres decir con|es eso de|seria eso de)\s+(?:el |la |los |las |lo de |un |una |se |eso de )?([a-z0-9]+)/,
  /\bcomo que\s+([a-z0-9]+)/,
  /\b([a-z0-9]+)(?:s)?\s+de\s+que\s*\??\s*$/,
  /\bno (?:se|entiendo) (?:que|lo que) es\s+(?:el |la |lo de |un |una )?([a-z0-9]+)/
];
const CLARIFY_NO_TERM =
  /^\s*¿?\s*a que te refieres\s*\??\s*$|\ba que te refieres con eso\b|^\s*¿?\s*(?:no (?:lo|te) entiendo|no entiendo eso|eso que significa|como que)\s*\??\s*$|\beso que (?:significa|quiere decir)\b/;

/** Aclaración sobre lo último dicho por el bot (con guard: el término citado debe estar en su frase). */
function isClarificationOfLastUtterance(text: string, lastBotUtterance?: string): boolean {
  if (CLARIFY_NO_TERM.test(text)) return true;
  const lastBot = normalize(lastBotUtterance ?? "");
  if (lastBot.length === 0) return false;
  for (const pattern of CLARIFY_WITH_TERM) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const term = match[1].replace(/s$/, ""); // singulariza burdo: "limites" -> "limite"
      if (term.length >= 3 && lastBot.includes(term)) return true;
    }
  }
  return false;
}

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
  // Quejas inequívocas del reparto (mitad y mitad, más para mí, otra agencia me da X): valen sin moneyContext.
  if (DIRECT_SHARE_COMPLAINT.test(text)) return "complains-about-share";
  // Queja de seguimiento durante la negociación (frase dirigida al dinero, sin repetir "reparto").
  if (input.moneyContext && FOLLOWUP_SHARE_COMPLAINT.test(text)) return "complains-about-share";
  if (DISTRUST.test(text)) return "distrust";
  if (WANTS_TO_THINK.test(text)) return "wants-to-think";
  if (NOT_INTERESTED.test(text)) return "not-interested";
  if (WANTS_TO_END.test(text)) return "wants-to-end";
  if (CONFORMITY.test(text)) return "follows-along";
  if (CONTINUATION.test(text)) return "follows-along";
  // Aclaración de lo que el bot ACABA de decir ("¿qué significa se liquida?", "¿límite de qué?"): se
  // reformula en simple, jamás "mi socio". Antes que repeat/QUESTION (todas contienen "que").
  if (isClarificationOfLastUtterance(text, input.lastBotUtterance)) return "asks-clarification";
  // Pide que el BOT repita lo último ("¿qué decías?", "no te escuché"): antes que QUESTION (contiene "que").
  if (ASKS_BOT_REPEAT.test(text)) return "asks-bot-to-repeat";
  // Pregunta la CIFRA del reparto (sin quejarse: las quejas ya se evaluaron antes) -> responderla (inv. 3
  // reactivo), nunca deferir. Antes que QUESTION/earnings ("cuánto os lleváis" contiene "cuanto").
  if (ASKS_SHARE_FIGURE.test(text)) return "asks-share-figure";
  // "¿Eres un robot?" -> identidad (sin mentir), antes que QUESTION.
  if (BOT_CHECK.test(text)) return "asks-identity";
  // Pregunta personal/broma al bot -> identidad con gracia (no "mi socio"), antes que QUESTION.
  if (PERSONAL_TO_BOT.test(text)) return "asks-identity";
  // "No sé" SUELTO (jul-2026, llamada real de Alex): es DUDA, no ruido — tranquilizar y seguir (REASSURE),
  // no el "¿me lo repites?" que sonaba a sordo. Con más contenido ("no sé si me fío") ya lo cazan otras.
  if (/^(?:no se|no lo se|nose|no sabria decirte?|no sabria)$/.test(text)) return "distrust";
  // Política de edad ANTES que earnings/identity/question: "¿qué edad hay que tener?" contiene "que" (QUESTION).
  if (ASKS_AGE_POLICY.test(text)) return "asks-age-policy";
  if (ASKS_EARNINGS.test(text)) return "asks-earnings";
  if (ASKS_IDENTITY.test(text)) return "asks-identity";
  if (GREETING.test(text)) return "follows-along";
  // "Sí, soy yo" / "con ella habla": confirmación de identidad al descolgar -> seguir.
  if (IDENTITY_CONFIRM.test(text)) return "follows-along";
  // Edad adulta declarada ("tengo 24", "tengo 24, ¿pasa algo?"): información -> asentir y seguir. ANTES
  // que QUESTION para que una coletilla trivial ("¿pasa algo?", "¿no?") no la convierta en "pregunta
  // desconocida" y acabe en el absurdo "lo comento con mi socio" (bug jul-2026). Si además hay una
  // pregunta SUSTANTIVA ("tengo 24, ¿cuánto cobraría?"), gana la pregunta. UNDERAGE (14-17) ya cortó antes.
  if (STATES_ADULT_AGE.test(text) && !SUBSTANTIVE_QUESTION.test(text)) return "follows-along";
  // Asentimiento a secas ("si?", "vale?"): avanzar, NO deferir. ANTES que QUESTION (que casa el "?" final) y
  // solo si NO hay una pregunta sustantiva encadenada (por si acaso), para no tragarse una pregunta real.
  if (BARE_AFFIRMATION.test(text) && !SUBSTANTIVE_QUESTION.test(text)) return "follows-along";
  if (QUESTION.test(text)) return input.isCoveredQuestion ? "asks-covered" : "asks-unknown";
  if (FOLLOWS_ALONG.test(text)) return "follows-along";

  // No reconocido (ruido/STT roto / frase no contemplada): se pide que lo repita en vez de asumir un "sí".
  return "unclear";
}
