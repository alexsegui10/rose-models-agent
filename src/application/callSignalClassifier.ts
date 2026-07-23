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
  /\b(idiota|imbecil|gilipoll\w*|subnormal|cabron|cabrona|payas[oa]|capull\w*|sinverguenza|chorizos?|estafador\w*|timador\w*)\b|(una|que|vaya|menuda|de) mierda|me jode\b|no me jodas|vete a (la mierda|tomar)|que (?:te|os) follen|\bjodete\b|\banda(?:te)? a la mierda\b|\b(?:vete|andate) a cagar\b|(?<!\bsi )(es una|menuda|vaya|menudo) (estafa|timo|fraude|robo|porqueria|verguenza|tomadura de pelo)|(estafa|timo|fraude) de mierda|huele a (estafa|timo|fraude)|(?<!\bsi )(esto|eso) es (una )?(estafa|timo|fraude|ilegal|porqueria|tomadura de pelo)|(sois|son) (?:todos? |todas? )?unos? (estafadores|ladrones|mentirosos|sinverguenzas|rateros|tramposos|chorizos)|(me|nos) (estais|estan) (enganando|timando|estafando|tomando el pelo)|os voy a denunciar|voy a (denunciar|llamar a la policia|llamar a la guardia)|esto es ilegal|hijo de|callate|\bchant\w*\b|\bpelotud\w*\b|\bgarca\b|\bconchud\w*\b|\banda a cagar\b|no me romp\w+ (?:mas )?(?:las pelotas|los huevos|la paciencia|las bolas)|la concha (?:de|tuya)|dejate de (gilipolleces|tonterias|chorradas|cuentos|historias|milongas|joder|romper\w*|hinchar|jorobar)/;
// Insultos RIOPLATENSES añadidos (barrido 20-jul, Yanina): "sos un chanta/pelotudo/garca/conchudo", "andá a
// cagar", "no me rompas las pelotas/los huevos/la paciencia", "la concha de/tuya", "dejate de joder/romper".
// NO se incluye "boludo/a" (afectuoso: "che boludo, dale") ni "me jode" (= me molesta, neutralizado aparte).
// (17-jul, 1a llamada real de Alex: "que te follen" no estaba y acababa en "eso prefiero mirartelo bien y te
// lo paso por WhatsApp" — un insulto tratado como una pregunta que consultar. Ahora escala como agresion.)

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
// Términos de queja completos (con el término de reparto, basta uno de cada). OJO: "car[oa]" es de PRECIO
// ("es caro", "sale cara"); el lookbehind excluye el HOMOGRAFO "la/mi/tu cara" (rostro) — sin él, "vale
// 70/30, ¿y la cara qué?" contaba como QUEJA de reparto y el redactor improvisaba política de cara (R9).
const COMPLAINT_TERMS =
  /(mucho|demasiad[oa]|(?<!\b(?:la|las|mi|tu|su|una|esa|esta|de|vuestra|vuestras)\s)car[oa]s?\b|carisim|abusiv|es un robo|un robo|injust|no es justo|muy poco|poco para mi|\bpoc[oa]\b|poquit|bajad|bajar|bajais|bajarlo|podeis bajar|reducir|menos|no me sale|no me compensa|no me convence|no me cuadra|no me parece justo|es un palo|un disparate|barbarid|excesiv|exager|un monton|monton)/;
// Queja de SEGUIMIENTO en negociación: SOLO frases dirigidas al dinero (no términos sueltos como
// "mucho"/"reducir" que podrían referirse al contenido/ritmo y regalarían un escalón sin queja real).
const FOLLOWUP_SHARE_COMPLAINT =
  /\bbaj[ae]\w*|\bpodeis bajar\b|\bsubirlo\b|\bsubir (?:un poco|algo|mas|mi parte)\b|\b(?:dar|dame|darme|darnos|dais|deis|dan|das)\b(?:me|nos|le)?\s*(?:un poco|algo)?\s*mas\b(?:\s+(?:porfa|porfi|porfis|por favor|please|plis|eh|anda))?(?!\s*\w)|no hay manera de subir|\bno me compensa\b|\bno me sale a cuenta\b|sigue siendo (?:muy )?(?:mucho|demasiad[oa]|car[oa]|alto|injusto|abusivo|un robo|un pico|poc[oa]|poquit[oa])|(?:es |hay )?mucha comision|demasiada comision|un poco menos|algo menos|me (?:quedo|queda|llevo|sigue quedando) (?:con )?(?:muy )?(?:poc\w*|poquit\w*)|\bno me hago\b|necesito mas (?:plata|dinero)|\bes un pico\b|\bes harto\b|me parece (?:mucho|demasiad[oa]|car[oa]|abusivo|injusto|un robo|un monton)|(?<!no )(?<!tampoco )(?<!para nada )me parece (?:mal|fatal)(?=\s*[.,!¡]*\s*$)|me parece (?:mal|fatal)\b[^.?!]{0,25}\b(?:reparto|porcentaje|comision)|(?:es|son|me parece) (?:mucho|demasiad[oa]|bastante|un monton) para (?:vosotros|ustedes|la agencia|vos)|os llevais (?:mucho|demasiad[oa]|bastante|un monton)|es bastante para|(?:otra agencia|mi agencia|la otra)[^,.!?]{0,25}(?:mejor|me dejan|me dan|me quedo con|el \d{2})|me dejan (?:el |un )?\d{2}\b|quiero (?:algo )?mas para mi|mas para mi(?: parte)?|me gustaria (?:quedarme )?(?:con )?mas|mitad y mitad|\b50\s*\/?\s*50\b|\b50\s*y\s*50\b|el (?:50|cincuenta)(?:\s*por\s*ciento)?\b|\bo nada\b|deberia ser (?:mas|50|mitad)|\b(?:no\s+)?(?:me\s+|nos\s+)?(?:lo\s+|la\s+)?(?:podeis|puedes|podes|pueden|puede|podrias|podriais|podrian)\s+mejorar(?:me|lo|la)?(?:\s+(?:eso|esto|el reparto|el porcentaje|la oferta|las condiciones|mi parte))?(?:\s+(?:un poco|algo))?\s*\??\s*$|\b(?:me\s+)?mejoras?\s+(?:el reparto|el porcentaje|la oferta|las condiciones|mi parte)\b/;
// Extensión 20-jul (barrido de negociación dura de Alex): más cues de INSATISFACCIÓN/EMPUJE con el reparto en
// moneyContext que se escapaban a asks-more/unclear (el bot AVANZABA el guion en vez de seguir negociando o
// escalar a Alex en el suelo). SOLO insatisfacción/empuje, NUNCA aceptación ("40 está bien" NO entra). Es
// SEGURO: la respuesta es la escalera DETERMINISTA (jamás filtra la cifra que ella pide, solo concede el
// escalón autorizado o escala en el suelo); el único coste de sobre-cazar es conceder de más, acotado por el
// gate moneyContext. Cubre: "me queda corto/flojo/escaso/justito", "sigue abajo/corto/flojo", "un puntito
// medio", "partir la diferencia", una cifra 40-69 que ELLA EMPUJA con verbo ("subime a 45", "dame 50",
// "necesito 50", "mejorame a 45") o coletilla ("45 aunque sea", "50 y cerramos", "50 para mi"), y "con el
// %/porcentaje ... flojo/corto/no me convence". Excluye cifras de CONTENIDO (fotos/reels/días...).
// + "(te/que/yo) quiero más" (1ª LLAMADA REAL 21-jul, Alba: tras el 30/70 dijo "Quiero más." y "Te quiero
// más." —con el "te" fantasma del ASR— y el bot fingió sordera, luego "qué maja" y CERRÓ con la negociación
// ABANDONADA). En moneyContext es inequívoco; excluye "quiero más información/detalles/fotos/tiempo...".
const FOLLOWUP_SHARE_COMPLAINT_EXTRA =
  /\b(?:me\s+(?:quedo|queda|llevo|deja\w*)|sigue(?:\s+siendo)?)\s+(?:con\s+)?(?:muy\s+|medio\s+|re\s+)?(?:cort\w*|floj\w*|escas\w*|justit\w*|abajo|baj[oa])\b|\bun(?:\s+puntito|\s+punto|\s+termino)?\s+medio\b|\bpart\w*\s+la\s+diferencia\b|(?<!\bno\s)(?<!\bno\s\w{1,3}\s)(?:\bte\s+|\bque\s+|\byo\s+)?\bquiero\s+(?:un\s+poco\s+)?mas\b(?!\s*(?:que\s+nada|info\w*|detall\w*|foto\w*|video\w*|tiempo|contenido|contexto|saber|datos?|explicac\w*|vueltas?|rollos?|charla|historias?))|\b(?:subi\w*|dame|darme|ponme|dejame\w*|mejora\w*(?:me|lo)?|necesito)\s+(?:me\s+|nos\s+|hasta\s+|a\s+|en\s+|el\s+|un\s+|aunque\s+sea\s+)*(?:4\d|5\d|6\d)\b(?!\s*(?:fotos?|reels?|dias?|videos?|minutos?|horas?|semanas?|mes(?:es)?|anos?|seguidor))|\b(?:4\d|5\d|6\d)\s+(?:aunque\s+sea|y\s+(?:cerramos|arreglamos|listo)|para\s+mi\b(?![^.?!]{0,15}\b(?:bien|perfecto|genial|joya|barbaro|listo|ok|me\s+sirve|me\s+vale)\b))|\bcon\s+el\s+(?:%|porcentaje)\b[^.?!]{0,25}\b(?:floj\w*|cort\w*|poc\w*|convenc\w*)\b/;

// (R9 10-jul, endurecido tras NO-APTO del revisor) "mejorar" solo cuenta como queja en forma de PETICION
// dirigida a la agencia: "¿(no) (me lo) podeis/puedes mejorar (eso|el porcentaje...)?" anclada a fin de
// frase, o "me mejoras la oferta". Un COMPROMISO de ELLA ("voy a mejorar", "se que tengo que mejorar",
// "prometo mejorar") JAMAS cuenta (regalaba el 65 sin queja real — misma familia que "dame mas X"). SOLO
// en moneyContext (gate del FOLLOWUP); "podeis mejorar las fotos" tampoco (objeto no-dinero rompe el ancla).

// Pide SALARIO / sueldo fijo (17-jul, 1a llamada real de Alex: "me gustaria pago por salario" en plena
// negociacion -> el bot CERRABA la llamada en vez de contestar). DECISION DE ALEX: se le explica que NO se
// trabaja por salario (va a porcentaje) y se SIGUE negociando — ni cerrar ni escalar. La respuesta es
// determinista y sin cifras; si despues insiste con el %, la escalera sigue su curso normal.
const ASKS_SALARY = /\bsalario\b|\bsueldo\b|\bpago fijo\b|\bpaga fija\b|\bmensualidad\b|\bfijo mensual\b|\bfijo semanal\b/;

// Desconfianza LEVE (worried) -> tranquilizar y seguir. Incluye sospecha HIPOTÉTICA ("y si es una
// estafa?"), que NO es agresión: por eso HOSTILE excluye las formas precedidas de "si".
const DISTRUST =
  /como se que\b|como se si\b|no me fio|me cuesta (creer|fiarme)|no me lo creo|(sera|no sera|sera esto) (una )?(estafa|timo|broma|mentira|verdad)|si (es|fuera|fuese|seria|esto es) (una )?(estafa|timo|fraude|mentira|engano)|y si me (estafan|enganan|timan|roban)|(esto es|es esto|esto sera) (real|seguro|legal|de verdad|fiable|verdad)|es (de )?fiar|me da (un poco de )?(cosa|miedo|reparo|cosica|repelus|no se que)|da (un poco de )?miedo|desconfi|no se si (fiarme|me fio|es verdad|esto es real)|no se si (?:me|nos) est[ae](?:n|is|s)?\s+(?:enganando|timando|estafando|cagando|tomando el pelo)|(seguro que|de verdad) (es legal|me vais a pagar|esto funciona)|no (me )?(van|vais|vayais) a (pagar|estafar|enganar)|y si es mentira/;

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

// RECHAZO EN FIRME de la cara (Increment 2, 8-jul): tema de cara/anonimato + una negativa EXPLICITA. La
// simple VERGUENZA ("me da corte/verguenza") NO entra aquí: es DUDA y se tranquiliza (la coge la comprensión
// o QUESTION -> conocimiento de la cara). El director reconduce a la 1ª y cierra si INSISTE. "anonim" por sí
// solo cuenta (buscar anonimato = negarse a la cara). Comparte los patrones de fondo con el bot de texto.
const FACE_TOPIC = /\b(?:cara|rostro|anonim)\b|\b(?:mostrarme|ensenarme|salir en|aparecer en)\b/;
const FACE_FIRM_REFUSAL_SIGNAL =
  /\bno(?:\s+\w+){0,2}\s+quiero\b|\bno pienso\b|\bno voy a\b|\bprefiero no\b|\bsigo sin\b|\bme niego\b|\bno la (?:muestro|enseno)\b|\bno (?:enseno|ensenar|mostrar|muestro)\b|\bno (?:quiero )?(?:salir|dar la cara)\b|\bno aparecer\b|\bque no se me vea\b|\bocultar\b|\btapar(?:me|la)?\b|\bdifuminar\b|\bpixelar\b|\bsin (?:mostrar|ensenar)\s+(?:la\s+|mi\s+)?cara\b|\bsin (?:la )?cara\b/;
// DUDA/verguenza de la cara (NO rechazo firme): "me da corte/verguenza", "soy timida". Red determinista para
// tranquilizar (RECONDUCT_FACE sin contar hacia el cierre) por si la comprensión no lo caza. Va DESPUÉS de
// FACE_FIRM_REFUSAL (una frase con negativa explícita gana) y no cierra nunca.
const FACE_SHYNESS_SIGNAL =
  /\bme da (?:mucho |mucha |un poco de |algo de )?(?:corte|verguenza|cosa|palo|apuro|reparo|pudor|no se que)\b|\bme corta\b|\bque (?:corte|verguenza)\b|\bsoy (?:muy |un poco |media )?timid[ao]\b|\btimidez\b/;
// DUDA DE PRIVACIDAD/RECONOCIMIENTO ("y si me reconoce alguien", "que me vea mi familia", "en mi pueblo").
// Va tambien a face-doubt -> RECONDUCT_FACE DETERMINISTA: asi el LLM NO redacta la respuesta a un miedo de
// reconocimiento (donde soltaria "tranquila, nadie te reconoce" = promesa de anonimato). Cierra el punto de
// entrada del leak que cazo el revisor. La cara es imprescindible; la reconduccion tranquiliza sin prometer.
const FACE_RECOGNITION_SIGNAL =
  /\bme recono[cz]\w*\b|\bque me vean?\b|\bme vea\s+\w+|\bme vean\s+\w+|\bgente (?:conocida|que me conoce|que conozco)\b|\bconocid[oa]s me\b|\b(?:de|en) mi (?:zona|pueblo|ciudad|barrio|entorno|trabajo)\b|\bque no me (?:vea|vean|reconozca|reconozcan)\b|\bmi ex\b|\bse enteren?\s+(?:en |mis |mi |la gente|de esto)\b/;

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
  /\bcuanto (?:se gana|gano|voy a ganar|ganaria|se saca|puedo ganar|ganan|dinero|sacaria|cobro|cobraria|cobrare|voy a cobrar|me llevo|me llevaria|se puede (?:ganar|sacar))\b|\bse gana bien\b|\bcuanto se gana al mes\b|\bgarp[ao]\w*\b|\bcuanto (?:me )?(?:vais|van|va) a pagar(?:me)?\b|\bcuanto (?:me )?paga(?:n|is|riais|rian)\b|\bcuanto (?:me )?pagas?\b/;
// + "cuanto me vais/van a pagar(me)" / "cuanto me pagan/pagáis" (1ª llamada REAL 21-jul, Alba): no lo cazaba
// el oído y llegaba por la comprensión IA (que no puede adelantar el MONEY por replay) -> ahora determinista.

// Quiere terminar / colgar -> cerrar con contrato. Incluye despedidas sueltas ("chau chau", "bye"):
// tras el cierre deben llevar a la despedida/silencio, no a repetir el discurso (barrido jul-2026).
const WANTS_TO_END =
  /(te dejo|te tengo que dejar|tengo que (irme|colgar|dejarlo|dejarte)|hablamos (luego|mas tarde|otro dia|en otro momento|manana)|ahora no puedo|no es buen momento|me tengo que ir|tengo prisa|me pillas (mal|liada)|adios|hasta luego|me voy|cuelgo|\bcha[ou]+\b|\bbye\b|\bnos vemos\b)/;

// AVISO DE TIEMPO ("te aviso que solo tengo una hora", "tengo poco tiempo"): NO es pregunta ni querer
// colgar — es "sigue, pero rapido". Antes caia en QUESTION (por el "que") -> defer absurdo a WhatsApp
// (sweep R9 10-jul). Va DESPUES de WANTS_TO_END: "tengo prisa, hablamos luego" sigue reagendando.
const TIME_NOTICE =
  /\b(?:te aviso|aviso)\b(?!\s+con\s+(?:tiempo|antelacion))[^.!?]{0,35}\b(?:horas?|ratos?|tiempo|minutos?)\b|\bsolo tengo (?:una hora|media hora|un rato|un ratito|\d+\s*minutos?)\b|\btengo poco tiempo\b|\b(?:luego|despues|en un rato|enseguida) (?:entro|me voy|tengo que ir)\w*/;
// Interrogativo FUERTE o "?": si el aviso de tiempo viene ENCADENADO a una pregunta real ("solo tengo media
// hora, ¿cuanto se gana?"), la pregunta gana (revisor R9: el aviso se la tragaba). "que"/"como" pelados no
// cuentan (son conjuncion en el propio aviso: "te aviso QUE solo tengo una hora").
const STRONG_QUESTION = /\b(?:cuant[oa]s?|cual|cuales|quien|donde|por\s?que|para\s?que)\b|\?\s*$/;

// Declaracion del ESTADO de su OnlyFans: "no tengo onlyfans", "nunca tuve of", "si tengo pero abandonado",
// "lo tengo abandonado". Es un DATO (el extractor de hechos lo registra), no ruido ni objecion: asentir y
// seguir. Las PREGUNTAS de OF ("¿necesito tener onlyfans?") las caza QUESTION antes.
const OF_STATUS_STATEMENT =
  /\b(?:no\s+|nunca\s+(?:he\s+)?|si\s+)?(?:teng[oa]|tuve|tenido)\b[^.!?]{0,25}\b(?:onlyfans|only\s?fans|of)\b|\b(?:onlyfans|only\s?fans|of)\b[^.!?]{0,25}\babandonad\w*|\bsi tengo pero\b[^.!?]{0,30}\babandonad\w*|\btengo\b[^.!?]{0,12}\babandonad\w*/;

// Conformidad que el detector de preguntas confundiría ("como tu digas"). Se evalúa ANTES que QUESTION.
const CONFORMITY =
  /(como tu (digas|veas|quieras)|como veas|lo que (tu )?(digas|veas|quieras|sea)|me parece que si|me da igual|tu mandas)/;

// Muletillas de "continúa" ("¿y?", "¿y qué más?", "sigue", "cuenta", "y luego"): NO son preguntas a
// deferir, son "dale, avanza". Se evalúan ANTES que QUESTION para que no se interpreten como duda.
// Ronda 3 (spec de Alex: el defer JAMÁS para lo que el bot sabe): "contame", "¿qué sería?", "¿cómo
// arrancamos?", "¿qué me pedirían hacer?" son peticiones de que el bot SIGA CONTANDO — la agenda las
// responde avanzando. Antes caían en asks-unknown -> "te lo confirmo por WhatsApp" (inadmisible). El guard
// (?!...porcentaje|cara...) evita robar peticiones que tienen ruta propia (cifra del reparto, cara, impuestos).
const CONTINUATION =
  /^¿?\s*y\s*\??$|^¿?\s*y\s+que(\s+mas|\s+es)?\s*\??$|^¿?\s*que\s+mas\s*\??$|\by\s+(luego|despues|que\s+mas)\b|\bsigue\b|\bcontinua\b|\bcuentame\b|como viene la mano|\bcontame\b|\bque seria\s*\??\s*$|\bcomo (?:arrancamos|empezamos|arranco|empiezo)\b|\bque (?:me )?pedirian?\b(?:\s+hacer)?/;
// Temas con RUTA PROPIA que un "contame/qué sería/cómo empezamos" jamás puede robar (revisor Ronda 3): si el
// mensaje los nombra, CONTINUATION no aplica y la petición cae a su ruta (cifra del reparto, cara, impuestos,
// "cuánto se llevan"). Sin esto, "¿cómo empezamos? igual antes decime cuánto se llevan" avanzaba la agenda
// IGNORANDO la cifra pedida — la familia evasiva que ya mordió el 16-jul.
const CONTINUATION_ROUTED_TOPICS = /\b(?:porcentaje|reparto|comision|cifra|cara|impuest\w*)\b|\bcuant[oa]s?\b/;

// Pregunta de IDENTIDAD ("¿quién eres?", "¿de dónde llamas?", "¿de qué agencia?", "¿cómo te llamas?"): NO se
// defiere; el bot dice quién es. Incluye preguntas personales al bot ("¿cuántos años tienes?"): deferirlas a
// "mi socio" no tiene sentido (bug jul-2026); se responden con identidad/simpatía. El lookahead (?!\s+que)
// evita confundir "¿cuántos años tienes que tener?" (eso es política de edad). Se evalúa ANTES que QUESTION.
const ASKS_IDENTITY =
  /\bquien (eres|es|habla|sois|son|me llama|llama)\b|\bde donde (llamas|llamais|me llamas|es esto|sois|llaman|eres)\b|\bde que (agencia|empresa|parte)\b|\bpara quien (trabajas|trabajais|es esto)\b|\bque agencia\b|\bcomo te llama(?:s|bas)\b|\b(?:cual|como) (?:es|era) tu nombre\b|\bme repites tu nombre\b|\bde parte de quien\b|\bcuantos anos (?:tienes|tenes|tiene usted)\b(?!\s+que)|\bque edad (?:tienes|tenes|tiene usted)\b(?!\s+que)/;

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

// IMPUESTOS / tema fiscal (DECISIÓN DE ALEX 16-jul): el bot NO habla de impuestos — es terreno fiscal y no
// hay contenido aprobado suyo, así que se DEFIERE a él ("eso te lo confirmo y te lo paso"), jamás se
// improvisa una respuesta fiscal. Antes el recuperador daba la pregunta por "cubierta" y el bot contestaba
// sobre las CUOTAS de la agencia ("con nosotros no pagas nada por entrar"): un sinsentido, no respondía lo
// que preguntaba (barrido de voz 16-jul, nº7, confirmado en vivo). Gana a `isCoveredQuestion`.
// Cubre los fraseos REALES (revisor 16-jul: la primera versión se dejaba media docena): enclíticos y
// conjugaciones ("hay que declararlo", "quién lo declara"), alta de autónoma, facturar, cotizar, cobrar en
// DELIBERADAMENTE SIMPLE (criterio de Alex, 16-jul): los impuestos son cosa de ELLA (OnlyFans le paga a su
// cuenta y desde ahí nos paga a nosotros), y estas preguntas casi no salen en la práctica. Así que basta con
// reconocer el TEMA y pasárselo a Alex. NO se persiguen fraseos exóticos ("facturar", "en negro", "darse de
// alta", "cotizar"...): daban falsos positivos reales ("las fotos las hago en negro" = color) y no aportan.
// Guard de "iva": el STT escribe a veces "iva" por "iba" ("yo iva a preguntarte..."), que no es el impuesto.
// declar\w*: solo el sentido FISCAL. Se EXCLUYE el reflexivo de IDENTIDAD ("declararme/declararte/declararse",
// "me declaro") que pisaba preguntas de privacidad/identidad cubiertas por el retriever (over-defer, 20-jul).
// Sigue cazando "declarar", "declararlo", "quién lo declara", "declaración" (money-referent, no reflexivo).
const TAX_TOPIC =
  /\bimpuesto\w*|\bafip\b|\bmonotribut\w*|\bhacienda\b|\bfiscal\w*|(?<!\b(?:me|te|se|nos)\s)\bdeclar(?!(?:ar|ando)?(?:me|te|se|nos)\b)\w*|\btribut\w*|\biva\b(?!\s+a\s)/;

// Deferencia FISCAL DELIBERADA (decisión de Alex, MEMORY nº7): los impuestos se DEFIEREN a Alex aunque el
// retriever los dé por "cubiertos" (la FAQ de cuotas hace que el bot suelte un sinsentido). Se expone para que
// el rescate IA del over-defer (callTurnResponder) NO los rescate y respete esa deferencia (revisor 20-jul).
export function isTaxDeferTopic(utterance: string): boolean {
  return TAX_TOPIC.test(normalize(utterance));
}

// ¿Es una pregunta? OJO: la conjunción causal "porque" (junta, "hago changas PORQUE no tengo fijo") NO va en
// el patrón — se confundía con el interrogativo y se difería un "detalle" inexistente al WhatsApp (auditoría
// 15-jul, voz). El interrogativo real "¿por qué...?" lleva "?" (lo caza el `?$`) o se escribe "por que" con
// espacio (que sí está); solo se excluye la forma junta causal.
const QUESTION =
  /\?\s*$|\b(que|como|cuando|cuanto|cuanta|cuantos|cual|cuales|donde|por que|quien|para que)\b|(me puedes|puedes|podrias|podeis|me podeis|sabes|sabeis) (decir|explicar|contar|aclarar|mandar|ensenar|saber|si)|(tengo|una|otra) (duda|pregunta)/;

// Afirmaciones / asentimiento -> avanzar. El prefijo tolera VARIAS coletillas encadenadas ("hola si",
// "mmm vale...", "eh bueno dale") — jul-2026, barrido de personas: "hola si" caía en unclear y el bot
// pedía repetir en el primer turno (sonaba a sordo).
const FOLLOWS_ALONG =
  /^\s*(?:(?:ah+|ahh|pues|bueno|hola+|buenas|holi|hey|oye|mira|mmm+|mm+|eh+|este|em+|uy|si\?)[\s,!¡.]*)*(vale|oka?y?|okis|si+|claro|perfecto|genial|de acuerdo|entiend\w*|aja+|aha+|ajam+|ajan+|mjm+|ahem|ujum+|ya|correcto|bien|guay|venga|estupendo|fenomenal|por supuesto|sip|dale|va|listo)\b|(?<!no )me parece (bien|genial|perfecto|justo|razonable|logico|correcto|estupendo|fenomenal)|suena bien|me gusta|adelante|cuentame|dime|sigue|esta bien|me vale/;

// Asentimiento a secas que ACABA en "?" (o sin el): "si?", "vale?", "ah si?", "claro?". Es un "si, dime", NO
// una pregunta. QUESTION lo confundia por el "?" final y el bot defieria algo inexistente a WhatsApp (bug del
// simulador de voz 7-jul: a un "si?" al descolgar solto "eso te lo confirmo por WhatsApp en cuanto colguemos").
// Anclado a FIN de cadena: "vale, pero cuanto gano?" NO entra aqui (esa SI es pregunta y la coge QUESTION).
const BARE_AFFIRMATION =
  /^\s*(?:(?:ah+|pues|bueno|si+|oye|mira|eh+|mmm+|mm+|holi|hey|hola+|buenas|uy)[\s,!¡.?]*)*(si+|vale|oka?y?|okis|claro|ya|dale|va|bueno|listo|correcto|perfecto|genial|bien|guay|aja+|ajam+|sip|entiend\w*)[\s,!¡.?]*$/;

// Afirmacion TENTATIVA / "si blando" ("puede ser", "ponele", "supongo", "maso", "capaz (que) si", "igual"):
// es un SI con reservas, no ruido. Antes caia en unclear -> "no te pillo" fingiendo sordera (sweep AR 14-jul,
// candidata monosilabica: "puede ser", "puede ser si", "si ponele"). Alex: "aceptar 'puede ser si' como un si".
// ANCLADA a la frase entera (coletillas + el token + colas tipo "que si"): una objecion ("puede ser pero no me
// convence") deja texto tras el token y NO casa; ademas se excluye cualquier "no" aparte en el clasificador.
const SOFT_AFFIRMATION =
  /^[\s,!¡.?]*(?:(?:ah+|pues|bueno|mmm+|mm+|eh+|si+|ya|dale|va|este|o sea)[\s,!¡.?]+)*(?:puede ser|puede|ponele|supongo|maso|mas o menos|capaz|seguramente|imagino|calculo|igual)(?:[\s,]+(?:que[\s,]+)?(?:si+|igual|supongo|ponele|ser|maso))*[\s,!¡.?]*$/;

// OPINION NEGADA: "no/tampoco/nunca/jamas/ya no ... me parece/gusta/convence/cuadra/encaja/vale/va bien/lo veo".
// Es un NO, JAMAS un asentimiento. Sin esto, "tampoco me parece justo" caia en FOLLOWS_ALONG (por "me parece
// justo") y el bot avanzaba/cerraba ignorando la objecion (rev-total 8-jul, roce invariante 3). Cubre negaciones
// NO adyacentes (tampoco/nunca/ya no) y con coma ("no, me parece justo") que el lookbehind estrecho no pillaba.
const NEGATED_OPINION =
  /\b(?:no|tampoco|nunca|jamas|ya no|para nada|en absoluto|nada)\b[,\s][^.?!]{0,20}\b(?:me parece|me gusta|me convence|me cuadra|me encaja|me vale|me va bien|lo veo bien)\b(?!\s+(?:mal|nada mal|tan mal))/;

// CONCESION + OBJECION ("yes-but"): un token de aceptacion (ya/vale/si/bueno/claro...) SEGUIDO de "pero" o
// "aunque" NO es un asentimiento, es la antesala de una objecion ("ya pero mi novio...", "vale pero no se
// si tendre tiempo"). Sin esto casaba FOLLOWS_ALONG por el token inicial y el bot avanzaba. Se evalua tras
// QUESTION (asi "vale pero cuanto gano?" sigue siendo pregunta) y NEGATED_OPINION.
const YES_BUT =
  /^\s*(?:(?:ah+|pues|bueno|mira|oye|mmm+|eh+|este|em+)[\s,]*)*(?:ya|vale|si+|claro|okay?|oka|okis|va|bueno|dale|de acuerdo|entiendo)\b[\s,]*(?:pero|aunque)\b/;

// Petición IMPERATIVA de que le MANDEN la info ("mandámelo", "pásame los datos", "mandámelo por whatsapp",
// "mandámelo pero si no está claro no sigo"): es consentimiento (a veces condicional), NO ruido -> asentir y
// seguir, JAMÁS "no te pillo" fingiendo sordera (barrido de voz 16-jul, desconfiada: "bueno, mandámelo, pero
// si no está claro ni en pedo sigo" caía en unclear -> ASK_REPEAT). Exige el verbo imperativo + un enclítico
// (me/melo/lo/la...) para no casar "qué pasa" ni "manda" a secas. Se evalúa al FINAL (solo rescata lo que
// caería en unclear): una PREGUNTA ("¿me lo mandas?") ya la cazó QUESTION antes. La petición de la CIFRA del
// reparto se EXCLUYE aparte (no debe aplanarse a follows-along: la maneja asks-share-figure — invariante 3).
const SEND_ME_INFO = /\b(?:manda|pasa|envia|tira)(?:melos|melas|melo|mela|noslo|nosla|nos|me|los|las|lo|la)\b/;

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
  /\bcuanto (?:os|se|te) (?:llevais|llevas|lleva|llevan|quedais|quedas|queda|quedan|cobrais|cobran)\b|\bcuanto cobr(?:ais|as|an)\b(?!\s+(?:las|los|una|un|otras)\b)|\bque (?:porcentaje|comision)\b|\bcomo (?:es|era|va|iba|funciona|queda) (?:el|lo del) reparto\b|\bel reparto como (?:es|era|va|iba|queda)\b|\bcual (?:es|era) (?:el|la) (?:reparto|porcentaje|comision)\b|\bcuanto (?:es|era) (?:el|la) (?:reparto|porcentaje|comision)\b|\b(?:el |la )?(?:porcentaje|reparto|comision)\b[^.?!]{0,12}\bque seria\b|\bque seria\b[^.?!]{0,12}\b(?:el |la )?(?:porcentaje|reparto|comision)\b/;

// CONFIRMAR la cifra ("o sea de lo que paguen me queda el 30, ¿no?"): ella repite el reparto para verificar
// que lo entendió. El bot LO SABE (spec de Alex: jamás deferir lo que se sabe) -> asks-share-figure re-dice
// la cifra autorizada vigente. Solo cifras de la escalera (30/35/40 los de ella): otra cifra NO confirma
// nada aquí (una petición del 50 la cazan las quejas antes).
const CONFIRMS_SHARE_FIGURE =
  /\b(?:me (?:queda|toca|llevo|corresponde)|para mi(?: es| seria| queda)?)\s+(?:el\s+|un\s+)?(?:30|35|40|treinta|treinta y cinco|cuarenta)\b(?!\s+de\s+(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre))[^.?!]{0,12}\b(?:no|verdad|cierto|si)\s*\?/;
// (El lookahead de meses evita que "la llamada me toca el 30 de julio, ¿no?" — una FECHA — dispare el
// reparto: revisor Ronda 3.)

// Pedir la cifra en IMPERATIVO ("decime/explicame/repetime/pasame ... el porcentaje/reparto"): es la MISMA
// petición reactiva que la forma pregunta -> se responde el escalón AUTORIZADO vigente (invariante 3), jamás
// se recita el 70/30 enlatado revirtiendo una concesión (barrido voz 16-jul nº1: cedido el 40, "decime bien
// el porcentaje" caía en asks-covered -> ANSWER_FROM_KNOWLEDGE -> 30/70, contradiciéndose; regla de Alex
// "siempre a más, nunca a menos"). Va con ASKS_SHARE_FIGURE (tras las QUEJAS, que se evalúan mucho antes).
// Excluye "dame" a propósito: "dame más porcentaje" es pedir MÁS (queja), no pedir oír la cifra. Exige un
// término explícito de la cifra (porcentaje/reparto/comision/cifra) para no robar una orden cualquiera.
const ASKS_SHARE_FIGURE_IMPERATIVE =
  /\b(?:decime|decinos|dime|deci|explicame|explica|repetime|repiteme|repeti|aclarame|aclara|contame|cuentame|conta|pasame|recordame|recuerdame)\b[^.?!]{0,20}\b(?:porcentaje|reparto|comision|cifra)\b/;
// El imperativo NO cuenta si el término de la cifra está NEGADO ("no el reparto", "explicame no el reparto
// sino como grabo") o DESESTIMADO ("el reparto no me importa"), ni si es el homógrafo "reparto de tareas/
// trabajo" (revisor 16-jul): ahí ella NO pide la cifra, y presentarla robaría su pregunta real. Guard de
// negación/alcance para el patrón imperativo (la forma pregunta ASKS_SHARE_FIGURE no lo necesita).
const SHARE_FIGURE_NOT_REQUESTED =
  /\bno\s+(?:el\s+|la\s+|lo del\s+|lo de la\s+|del\s+|de la\s+|me hables del\s+|me digas el\s+)?(?:porcentaje|reparto|comision|cifra)\b|\b(?:porcentaje|reparto|comision|cifra)\b[^.?!]{0,15}\b(?:no me (?:importa|interesa|va|preocupa)|me da igual|da igual)\b|\breparto de (?:tareas|trabajo|tarea|labores|roles)\b/;

// Pregunta VAGA por el DINERO (no la cifra exacta ni una queja): "y del dinero como va la cosa", "el pago
// como funciona", "y el dinero?" (DECISION de Alex 8-jul: presentar el reparto, que es la etapa MONEY del
// guion; asks-share-figure -> si MONEY no se cubrio, la presenta; si ya, repite la cifra autorizada). Va
// DESPUES de las quejas (SHARE/COMPLAINT/FOLLOWUP) y de asks-earnings-por-orden: no lleva "es/poco" como
// gatillo (para no tragarse "el dinero es poco", que es queja). Solo verbos de "como va/funciona".
// ESTRICTO (dos rondas de fuga cazadas por el revisor 8-jul): "¿cómo va el dinero?" (pregunta -> presentar
// reparto) es indistinguible en superficie de "el dinero como va bien, no me importa" (conformidad -> NO
// presentar) salvo por lo que va DESPUES del verbo. En vez de una lista negra de coletillas evaluativas
// (bien/genial/no me importa/...), que seria whack-a-mole, se ANCLA a FIN de frase: tras "como va/funciona"
// solo se admite un relleno NEUTRO (la cosa/esto/eso/el tema) o el final; cualquier cola evaluativa deja
// texto antes del $ y NO casa. Asi una afirmacion conforme nunca dispara el 70/30 (invariante 3).
const ASKS_MONEY_MODEL =
  /\b(?:el dinero|del dinero|lo del dinero|el pago|del pago|el cobro|la plata)\s+como (?:va|funciona|marcha|se reparte|se maneja)(?:\s+(?:la cosa|esto|eso|el tema))?\s*\??\s*$|^\s*(?:y\s+|oye\s+|pero\s+|bueno\s+)?¿?\s*como (?:va|funciona|marcha|se reparte|se maneja)\s+(?:el dinero|lo del dinero|el pago|el cobro|la plata)\s*\??\s*$|^\s*¿?\s*y\s+(?:el dinero|el pago|lo del dinero|la plata|el cobro|el reparto|el porcentaje|la comision)\s*\??\s*$/;

// Pregunta si es un ROBOT/IA ("¿eres un robot?", "¿hablo con una máquina?"): se responde con IDENTIDAD
// (soy Alex, el de Rose Models), sin afirmar ni negar ser humano (el validador veta "soy una persona").
// El RECHAZO a la máquina ("no quiero hablar con un robot") lo caza antes REJECT_MACHINE (wants-human).
const BOT_CHECK =
  /\beres (?:un |una )?(?:robot|bot|ia|maquina|inteligencia artificial|grabacion|contestador)\b|\bhablo con (?:un |una )?(?:robot|bot|maquina|ia|grabacion|persona|humano|humana)\b|\beres (?:real|de verdad|una persona|humano|humana)\b|\bsos (?:un |una )?(?:robot|bot|ia|maquina|humano|humana|persona)\b|\bsos (?:real|de verdad|una persona real)\b/;

// Pregunta PERSONAL/charla dirigida al bot ("¿estás soltero? jaja", "¿tú también tienes OnlyFans?",
// "¿qué hora es allí?"): se gestiona como IDENTIDAD (el brief ya manda salir del paso con humor, sin
// inventar datos) — jamás "lo hablo con mi socio" para una broma (barrido 3-jul).
const PERSONAL_TO_BOT =
  /\b(?:tu|vos) tambien\b[^.?!]{0,25}\b(?:onlyfans|of|fotos|contenido)\b|\bestas solter[oa]\b|\btienes (?:novia|novio|pareja)\b|\bque hora es (?:alli|alla|ahi|por alla|en espana|donde estas)\b|\bcomo estas tu\b|\by tu que tal\b|\bcuantos anos me das\b|\beres guap[oa]\b/;

// Pide que el BOT repita ("¿qué decías?", "no te escuché", "se corta, repite"): repetir lo último dicho,
// NUNCA deferir a WhatsApp ni pedirle a ELLA que repita (jul-2026, barrido: acababa en el absurdo
// "eso te lo confirmo por WhatsApp" cuando ella solo pedía que repitiera).
// El "que" pelado usa \?? (opcional, espejo del "como"): el STT suele omitir el signo, y un "que" solo es
// "¿que? no te oi", NO una pregunta de negocio a deferir (bug sweep 8-jul). Recap con gerundio ("que (me)
// estabas contando/diciendo/explicando") tambien es pedir que repita, no una pregunta desconocida.
const ASKS_BOT_REPEAT =
  /\bque (?:(?:me )?estabas (?:diciendo|contando|explicando)|(?:me )?decias|dijiste|has dicho|me contabas|contabas)\b|\bme lo (?:repites|puedes repetir|repetis|repite)\b|\brepite(?:melo|me)?\b|\bno te (?:escuche|escucho|oigo|oi|he oido|entendi bien)\b|\bse (?:corto|ha cortado|entrecorta|escucha entrecortado)\b|^\s*¿?\s*como\s*\??\s*$|^\s*¿?\s*que\s*\??\s*$/;

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
  // "y eso pa/para que?" retrospectivo: pregunta el para-qué de lo que el bot ACABA de decir -> aclarar (no
  // deferir a WhatsApp algo que él mismo narró). Solo si hay una última frase del bot que aclarar (guard).
  if (/^\s*¿?\s*(?:y\s+)?(?:eso|esto)?\s*(?:pa|para)\s+que\b/.test(text)) return true;
  // ECO-CONFIRMACIÓN (Ronda 3, spec de Alex): repite lo que el bot ACABA de decir y pide confirmación con
  // coletilla ("sí, ahí entendí... o sea yo no hablo con nadie, ¿no?"). Antes caía en asks-unknown -> "te lo
  // confirmo por WhatsApp": el bot DIFERÍA LO QUE ÉL MISMO ACABABA DE DECIR (inadmisible). Si su frase acaba
  // en coletilla de confirmación y solapa con la última frase del bot (2+ palabras con chicha, o 1 + un
  // marcador de reformulación tipo "o sea/entendí/entonces"), es una aclaración: se le confirma en simple.
  const tagQuestionEnd = /(?:,|\s)(?:no|si|verdad|cierto|asi)\s*\?\s*$/;
  if (tagQuestionEnd.test(text)) {
    const contentWords = text
      .replace(tagQuestionEnd, "")
      .split(/[^a-z0-9ñ]+/i)
      .filter((word) => word.length > 3);
    // Palabra ENTERA (\b), no substring: con includes(), genéricas como "para"/"esta" puntuaban dentro de
    // otras palabras y metían ruido (nota del revisor Ronda 3).
    const hits = contentWords.filter((word) => new RegExp(`\\b${word}\\b`).test(lastBot)).length;
    const restates = /\b(?:o sea|osea|entendi|entonces|es decir|asi que)\b/.test(text);
    if (hits >= 2 || (hits >= 1 && restates)) return true;
  }
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
  if (HOSTILE.test(text)) {
    // Excepciones a la agresión: modismos rioplatenses que contienen "mierda"/"me jode" sin ser un ataque
    // (barrido de voz 16-jul, candidatas VÁLIDAS mandadas a handoff hostil por error):
    //  - "no escucho/entiendo una mierda" = mala señal ("no oigo nada"), no un insulto (Belen).
    //  - "me jode" (me molesta) = objeción/lo que le fastidia, NUNCA el insulto en sí ("lo que me jode", "no
    //    me jode tanto", "me jode un poco el %"); el ataque real, si lo hay, está en OTRA palabra. Se neutraliza
    //    "me jode" entero (barrido 16-jul Priscila + 20-jul Malena "a Drive no me jode tanto" → handoff falso).
    //    OJO: "no me jodas" (imperativo = insulto) NO contiene "me jode\b", así que sigue siendo hostil.
    // Se degradan SOLO si el modismo era el ÚNICO disparador: se re-evalúa HOSTILE con el modismo neutralizado;
    // si aún queda un insulto real ("sois una mierda, y me jode"), sigue siendo hostil.
    const withoutIdioms = text
      .replace(/\b(?:escuch\w+|oig\w+|oye\w*|entiend\w+|entend\w+|pill\w+|capt\w+)\s+(?:ni\s+)?(?:una\s+)?mierda\b/g, " ")
      .replace(/\bme jode\b/g, " ")
      // DUDA enmarcada, no acusación (Ronda 2, 17-jul): "¿cómo sé que NO me están estafando?" / "no sé si me
      // están timando" es una candidata PREOCUPADA — el "me están estafando" de dentro disparaba HOSTILE y se
      // la mandaba a handoff como agresiva. Neutralizado el marco de duda, DISTRUST la recoge ("como se que")
      // y se la tranquiliza. Una acusación directa ("me estáis estafando") sigue siendo hostil.
      .replace(
        /\b(?:como se que|no se si|y si|que)\s+no\s+(?:me|nos)\s+est[ae](?:n|is|s)?\s+(?:enganando|timando|estafando|cagando|tomando el pelo)\b|\b(?:no se si|y si)\s+(?:me|nos)\s+est[ae](?:n|is|s)?\s+(?:enganando|timando|estafando|cagando|tomando el pelo)\b/g,
        " "
      )
      // "que NO es una estafa" (negado/duda: "¿cómo sé que no es una estafa?", "dime que no es un timo"):
      // el patrón de "es una estafa" casaba aunque fuera NEGADO y mandaba a handoff hostil a una candidata
      // preocupada (barrido Ronda 2). Neutralizado, DISTRUST la recoge. "esto ES una estafa" sigue hostil.
      .replace(/\bno\s+(?:es|sea|fuera|sera)\s+(?:una\s+)?(?:estafa|timo|fraude|mentira|engano)\b/g, " ");
    if (HOSTILE.test(withoutIdioms)) return "hostile-or-suspicious";
    // El único marcador hostil era el modismo -> NO es agresión: cae al flujo normal (mala señal, cara, etc.).
  }
  if ((HUMAN_REF.test(text) && WANT_HUMAN_VERB.test(text)) || REJECT_MACHINE.test(text)) return "wants-human";
  // Salario ANTES que las quejas del reparto: "me parece mal, quiero salario" debe recibir la explicacion de
  // no-salario (decision de Alex 17-jul), no un escalon regalado de la escalera. Si luego insiste con el %,
  // esa siguiente queja SI negocia con normalidad. Guard del revisor: si en la MISMA frase se esta DESPIDIENDO
  // o declinando ("te dejo, sin sueldo fijo no me sirve, chau"), gana el cierre — no se le vende a quien cuelga.
  if (ASKS_SALARY.test(text) && !NOT_INTERESTED.test(text) && !WANTS_TO_END.test(text) && !WANTS_TO_THINK.test(text)) {
    return "asks-salary";
  }
  if (SHARE_TERMS.test(text) && COMPLAINT_TERMS.test(text)) return "complains-about-share";
  // Quejas inequívocas del reparto (mitad y mitad, más para mí, otra agencia me da X): valen sin moneyContext.
  if (DIRECT_SHARE_COMPLAINT.test(text)) return "complains-about-share";
  // Queja de seguimiento durante la negociación (frase dirigida al dinero, sin repetir "reparto"). El EXTRA
  // (20-jul) suma cues de insatisfacción/empuje que se escapaban a asks-more/unclear (el bot avanzaba en vez
  // de seguir negociando/escalar). Ambos SOLO en moneyContext (la respuesta es la escalera determinista).
  if (input.moneyContext && (FOLLOWUP_SHARE_COMPLAINT.test(text) || FOLLOWUP_SHARE_COMPLAINT_EXTRA.test(text))) {
    return "complains-about-share";
  }
  // Rechazo EN FIRME de la cara / anonimato: antes que DISTRUST/NOT_INTERESTED/QUESTION (una duda de cara
  // "me da corte" NO entra aquí: no lleva señal de negativa explícita, así que se tranquiliza como duda).
  // "anonim" cuenta como rechazo SOLO si ella QUIERE anonimato; NO si lo NIEGA ("no busco nada anonimo", que
  // es una ACEPTACIÓN de dar la cara) ni si PREGUNTA por el proceso ("¿esto es anonimo?" acaba en "?") — sin
  // esto cerraba a candidatas válidas (riesgo del revisor 8-jul). La negativa de la cara la sigue cazando
  // FACE_FIRM_REFUSAL_SIGNAL aparte.
  const wantsAnonymity =
    /\banonim/.test(text) &&
    !/\?\s*$/.test(text) &&
    !/\bno\s+(?:busco|necesito|quiero|me importa|preciso|pido|hace falta)\b/.test(text);
  if ((FACE_TOPIC.test(text) && FACE_FIRM_REFUSAL_SIGNAL.test(text)) || wantsAnonymity) return "face-refusal";
  // Duda/verguenza sobre la cara (sin negativa explícita): tranquilizar, NUNCA cerrar. Red determinista por
  // si la comprensión no lo caza (el sim vio "me da verguenza lo de la cara" caer en ASK_REPEAT).
  if (FACE_TOPIC.test(text) && FACE_SHYNESS_SIGNAL.test(text)) return "face-doubt";
  // Miedo de reconocimiento/privacidad -> tambien face-doubt (RECONDUCT_FACE determinista): el LLM no redacta
  // la respuesta, asi no promete "nadie te reconoce" (leak del revisor). Va antes que DISTRUST/QUESTION.
  if (FACE_RECOGNITION_SIGNAL.test(text)) return "face-doubt";
  if (DISTRUST.test(text)) return "distrust";
  if (WANTS_TO_THINK.test(text)) return "wants-to-think";
  if (NOT_INTERESTED.test(text)) return "not-interested";
  if (WANTS_TO_END.test(text)) return "wants-to-end";
  // Aviso de TIEMPO ("solo tengo una hora"): seguir (rapido), no defer ni cerrar. DESPUES de WANTS_TO_END
  // ("tengo prisa, hablamos luego" sigue reagendando) y ANTES de QUESTION (lleva "que" y deferia). Si viene
  // ENCADENADO a una pregunta real ("solo tengo media hora, ¿cuanto se gana?"), la pregunta gana.
  if (TIME_NOTICE.test(text) && !STRONG_QUESTION.test(text)) return "follows-along";
  if (CONFORMITY.test(text)) return "follows-along";
  // "¿y qué más?" / "sigue, cuéntame" es pedir MÁS (asks-more): a media llamada avanza la agenda igual que
  // un asentimiento, pero tras el CIERRE no es un ack — se responde el remate ("nada más por mi parte...")
  // una vez en lugar de silencio (fleco de la re-sim R9: "¿y qué más me tienes que contar?" quedaba mudo).
  if (CONTINUATION.test(text) && !CONTINUATION_ROUTED_TOPICS.test(text)) return "asks-more";
  // Aclaración de lo que el bot ACABA de decir ("¿qué significa se liquida?", "¿límite de qué?"): se
  // reformula en simple, jamás "mi socio". Antes que repeat/QUESTION (todas contienen "que").
  if (isClarificationOfLastUtterance(text, input.lastBotUtterance)) return "asks-clarification";
  // Pide que el BOT repita lo último ("¿qué decías?", "no te escuché"): antes que QUESTION (contiene "que").
  if (ASKS_BOT_REPEAT.test(text)) return "asks-bot-to-repeat";
  // Pregunta la CIFRA del reparto (sin quejarse: las quejas ya se evaluaron antes) -> responderla (inv. 3
  // reactivo), nunca deferir. Antes que QUESTION/earnings ("cuánto os lleváis" contiene "cuanto").
  if (
    ASKS_SHARE_FIGURE.test(text) ||
    (ASKS_SHARE_FIGURE_IMPERATIVE.test(text) && !SHARE_FIGURE_NOT_REQUESTED.test(text)) ||
    CONFIRMS_SHARE_FIGURE.test(text)
  ) {
    return "asks-share-figure";
  }
  // Pregunta VAGA por el dinero -> presentar el reparto (misma señal; el director presenta MONEY si falta o
  // repite la cifra vigente). Tras las quejas; antes que earnings/QUESTION. Decisión de Alex 8-jul.
  if (ASKS_MONEY_MODEL.test(text)) return "asks-share-figure";
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
  // Una opinion NEGADA nunca es asentimiento: en negociacion cuenta como queja de reparto (sigue la escalera);
  // en general se pide aclarar en vez de avanzar como si aceptara. ANTES de QUESTION y de FOLLOWS_ALONG.
  if (NEGATED_OPINION.test(text)) return input.moneyContext ? "complains-about-share" : "unclear";
  // "Si blando" tentativo ("puede ser", "ponele", "supongo que si", "capaz si"): asentir y seguir, NUNCA
  // "no te pillo" fingiendo sordera (sweep AR 14-jul). ANTES de QUESTION porque "supongo QUE si" lleva "que"
  // (lo cazaba QUESTION -> defer). Anclada a la frase entera y excluye "no": jamas roba una pregunta real.
  if (SOFT_AFFIRMATION.test(text) && !/\bno\b/.test(text)) return "follows-along";
  // "es que"/"ya que"/"asi que"/"sino que"/"puesto que"/"dado que" son CONJUNCIONES PURAS, NUNCA interrogativas:
  // no deben disparar QUESTION por llevar "que" (bug rev-total 8-jul: "hola si, es que estaba con el nino, dime
  // dime" se tomaba como pregunta desconocida y se defiere). Se neutralizan SOLO esas antes de mirar si es
  // pregunta; cualquier OTRO interrogativo o el "?" final siguen contando. OJO: "lo que" NO se neutraliza a
  // proposito (es un relativo AMBIGUO que SI puede encabezar una pregunta: "lo que gano es mio?"); se deja como
  // estaba (lo coge QUESTION -> asks-*), asi el fix del "es que" no introduce falsos negativos con "lo que".
  const withoutConjunctionThat = text.replace(/\b(?:es|ya|asi|sino|puesto|dado)\s+que\b/g, " ");
  if (QUESTION.test(withoutConjunctionThat)) {
    // Impuestos -> a Alex, aunque el recuperador crea que lo cubre (criterio de Alex 16-jul). Va DESPUÉS de
    // asks-share-figure a propósito: "¿cuánto os lleváis después de impuestos?" SÍ pide la cifra del reparto
    // y debe responderse (invariante 3 es reactivo), no evadirse.
    if (TAX_TOPIC.test(text)) return "asks-unknown";
    return input.isCoveredQuestion ? "asks-covered" : "asks-unknown";
  }
  // Declaracion del ESTADO de su OnlyFans ("no tengo onlyfans", "si tengo pero abandonado", "lo tengo
  // abandonado"): es INFORMACION, no ruido -> asentir y seguir (el redactor la reconoce; el extractor de
  // hechos la recuerda). Sweep R9 10-jul: caia en unclear -> "no te pillo" x2 fingiendo sordera. Va ANTES
  // de YES_BUT ("si tengo PERO abandonado" es dato, no objecion) y DESPUES de QUESTION (una pregunta gana).
  // Si el dato viene con NEGATIVA a futuro ("y no pienso hacerme uno") o DUDA ("tengo mis reservas"), NO se
  // aplana como asentimiento (revisor R9): cae a la comprension, que la entiende como duda/objecion.
  if (
    OF_STATUS_STATEMENT.test(text) &&
    !/\b(?:no pienso|no voy a|no quiero|ni loca|ni de broma)\b/.test(text) &&
    !/\b(?:reservas|dudas?|miedo|reparos?)\b/.test(text)
  ) {
    return "follows-along";
  }
  // "ya pero..."/"vale pero..."/"bueno pero..." = CONCESION + OBJECION (yes-but): el token de aceptacion va
  // seguido de un CONTRASTE, asi que NO es asentimiento. Sin esto, "ya pero mi novio no se si lo va a llevar
  // bien" casaba FOLLOWS_ALONG por el "ya" inicial -> follows-along -> el bot AVANZABA atropellando la
  // objecion (sweep 8-jul). Cae a unclear -> la comprension lo entiende como duda y tranquiliza. OJO: va
  // DESPUES de QUESTION (para que "vale pero cuanto gano?" siga siendo pregunta) y de NEGATED_OPINION.
  if (YES_BUT.test(text)) return "unclear";
  if (FOLLOWS_ALONG.test(text)) return "follows-along";

  // Menciona que trabaja / esta con OTRA agencia (afirmacion, no pregunta): reconocer y SEGUIR, nunca "no te he
  // pillado, repite" (bug rev-total 8-jul: "yo ya trabajo con otra agencia" caia en unclear -> ASK_REPEAT,
  // fingiendo sordera a una frase clara). Va al final: una queja de reparto ("en otra agencia me dan mas") la
  // caza DIRECT_SHARE_COMPLAINT antes, y una PREGUNTA de multi-agencia ("puedo con las dos?") la caza QUESTION.
  if (
    /\b(?:otra agencia|otras agencias|con una agencia|otra empresa|con un manager\b|un representante|otro estudio|otra gente que me lleva)\b/.test(
      text
    )
  ) {
    return "follows-along";
  }

  // "Mandámelo / pásame los datos": consentimiento imperativo a que le envíen la info -> seguir, no fingir
  // sordera. Se excluye la petición de la CIFRA/reparto (términos de dinero): esa NO se aplana a follows-along
  // (la maneja asks-share-figure; aplanarla enmascararía el bug de la negociación — invariante 3).
  if (SEND_ME_INFO.test(text) && !SHARE_TERMS.test(text) && !/\b(?:cifra|dinero|plata|pago|paga)\b/.test(text)) {
    return "follows-along";
  }

  // No reconocido (ruido/STT roto / frase no contemplada): se pide que lo repita en vez de asumir un "sí".
  return "unclear";
}
