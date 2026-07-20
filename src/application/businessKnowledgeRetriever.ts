import { businessKnowledgeEntries } from "@/content/business";
import type { Candidate } from "@/domain/candidate";
import type { KnowledgeCategory, KnowledgeEntry } from "@/domain/businessKnowledge";
import type { ConversationIntent } from "./llmProvider";

export interface BusinessKnowledgeRetrievalInput {
  candidate: Candidate;
  intent: ConversationIntent;
  question: string;
  categories?: KnowledgeCategory[];
  /**
   * Categorias que la IA (understanding) marco RELEVANTES para este mensaje. Se usan SOLO para PRIORIZAR
   * (suman score a las entradas de esa categoria), de forma ADITIVA: nunca filtran ni saltan `isUsableEntry`
   * (gating de ACTIVE/aprobado/allowedStates/sensitive/DRAFT intacto). Asi una pregunta cuyo fraseo no pilla
   * ningun regex igualmente surfacea su conocimiento. NO decide negocio (invariante 1): el % sigue gateado
   * por el planner + factualValidator. Distinto de `categories`, que SI filtra.
   */
  relevantTopics?: KnowledgeCategory[];
  includeDrafts?: boolean;
  limit?: number;
  /**
   * Ignora el gating por `allowedStates` (no el de DRAFT ni el de tags "sensitive"). Lo usa el bot de
   * LLAMADA: la candidata ya está cualificada/agendada, así que cualquier hecho de negocio aprobado y no
   * sensible es respondible, aunque las entradas estén marcadas para estados del funnel del DM.
   */
  ignoreStateGating?: boolean;
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

  // La llamada (ignoreStateGating) responde cualquier hecho aprobado y no sensible aunque la entrada esté
  // marcada para estados del DM (la candidata ya está cualificada). El gating de DRAFT y "sensitive" se
  // mantiene (el % sigue sin salir por aqui).
  if (input.ignoreStateGating) return true;

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

  // GLOSARIO (fix /loop 20-jul): cuando pide el SIGNIFICADO de un termino (tag glossary-*, solo se empuja ante
  // "que es/no entiendo X"), la DEFINICION debe GANAR al pitch de servicios, que comparte palabras (chatting/
  // trafico/monetizacion) y por word-overlap le ganaba -> "que es un chatter?" recibia el pitch operativo en
  // vez de la definicion simple (queja #4 de Alex). Boost fuerte para que la ficha glossary-* quede primera.
  for (const tag of tags) {
    if (tag.startsWith("glossary-") && entry.tags.includes(tag)) score += 5;
  }

  // NO-COST autoritario (Fase 1b, medición OpenAI 20-jul): "¿me cuesta algo / caro para arrancar / invertir
  // plata?" tiene UNA respuesta clara (no hay coste para ti). La señal GRUESA de la IA (relevantTopics=COMMERCIAL,
  // que marca a veces por error para preguntas de coste) NO debe pisarla surfaceando el reparto. El detector de
  // coste ya está bien acotado (adversarial: no dispara con iphone/alquiler caros). Boost para que sea autoritario.
  if (tags.includes("no-cost") && entry.tags.includes("no-cost")) score += 3;

  // Boost ADITIVO por la relevancia que marco la IA (Pieza 1): si la categoria de la entrada esta entre las
  // relevantTopics del understanding, suma score suficiente para surfacearla aunque ningun regex de tags la
  // haya pillado (cubre fraseos que las keywords no captan). NO salta isUsableEntry: sensitive/DRAFT/estados
  // siguen filtrando antes; el % sigue gateado por el planner. Solo PRIORIZA conocimiento ya permitido.
  if (input.relevantTopics?.includes(entry.category)) score += 1.5;

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

  // --- Señales de desambiguación (Fase 1a, barrido 20-jul): se calculan arriba porque varias reglas de
  // abajo las consultan para no pisarse por solapamiento de palabras (mismo léxico, temas distintos). ---
  // "trafico" es jerga del negocio (tráfico de compradores) pero también el TRÁNSITO vehicular en smalltalk
  // ("uff el trafico en el centro estaba imposible"): ahí NO enruta al pitch de servicios (sería no-sequitur).
  // "trafico DE CLIENTES/compradores" o "el trafico que traeis/generais" es NEGOCIO aunque aparezca una
  // palabra de tránsito (barrido adversarial 20-jul: "el trafico de clientes que traen va por la ciudad").
  const trafficBusiness =
    /\btrafico\b[^.!?]{0,18}\b(?:de (?:clientes|compradores|gente|seguidores|visitas|usuarios|fans)|que (?:traeis|traen|gener\w+|me tra\w+|hacen|mandan|mandais))\b/.test(
      message
    ) || /\b(?:traeis|traen|gener\w+|me tra\w+|mandan|mandais)\b[^.!?]{0,12}\btrafico\b/.test(message);
  const trafficTransit =
    /\btrafico\b/.test(message) &&
    !trafficBusiness &&
    /\b(en el centro|la calle|la ciudad|autos?|coches?|camion\w*|colectivo|bondi|subte|micro|hora pico|embotell\w*|atasco|congestion|la ruta|autopista|panamericana|avenida|peaje|transito|semaforo|choque|accidente|esquina|cortad[oa]|manej\w*|conduc\w*|para llegar|llegar (?:al|a la|tarde)|estaba imposible|esta imposible|un caos|una hora (?:parada|clavada)|media hora (?:parada|clavada))\b/.test(
      message
    );
  // TIMING del pago ("cada cuanto me pagan", "cuanto tarda en caerme la plata", "cuando me depositan") ->
  // liquidación (cada 14 días), NO "no hay salario fijo" (misma familia de palabras) ni el lanzamiento
  // (comparten "cuanto tarda"). Anclado a DINERO explícito (barrido adversarial 20-jul: "cada cuanto entra
  // gente", "cuando llega el frio", "cuanto tarda en caerse una cuenta" NO son el pago). "entra/llega/cae la
  // plata de mi laburo" tampoco (es SU sueldo de otro lado).
  const paymentTiming =
    (/\b(cada cuanto|cuando|cuanto tarda|cuanto tardan|cuanto demora|cuanto demoran|en cuanto tiempo)\b[^.!?]{0,22}\b(?:pag\w*|cobr\w*|deposit\w*|acredit\w*|liquid\w*|plata|dinero|guita|la paga)\b/.test(
      message
    ) ||
      /\b(?:cae|caer|caerme|caen|llega|llegar|entra|entran)\b[^.!?]{0,15}\b(?:la plata|el dinero|el pago|la guita)\b/.test(
        message
      )) &&
    !/\b(mi laburo|mi trabajo|mi sueldo|del laburo|de otro lado|otro laburo)\b/.test(message);
  // ¿Pide el SIGNIFICADO de un término de la jerga? (glosario). Se calcula aquí para que el pitch de
  // servicios NO se dispare cuando es una pregunta de definición ("qué es el tráfico" ≠ "cómo trabajáis").
  // OJO (barrido adversarial 20-jul): "que es LO QUE hacen/ofrecen" = PITCH, no definición -> se excluye con
  // lookahead para que NO suprima servicios ni empuje el glosario.
  const asksDefinition =
    /\b(que es(?! (?:lo que|todo lo|eso que|lo de que))|que son|que significa|que quiere decir|a que (?:te )?refieres|no se que (?:es|significa)|no entiendo (?:que es|lo de|eso de)|que es eso de|ni idea (?:de )?que es|no lo cacho|no lo pillo|no cacho)\b/.test(
      message
    ) || /\bno (?:te )?entiendo\b/.test(message);

  if (
    /\b(sueldo|salario|fijo|paga|pagan|pagais|pagais|pagaria|pagariais|me pagariais|pagarian|pagaran|pagos|cobro|cobrar|cobraria|cobrarias|ganaria|cuanto se gana|cuanto gano|cuando (?:me )?pag|cuando (?:cobro|cobraria|se cobra|se paga)|cada cuanto (?:cobro|pagais|se paga|me pagais)|como (?:cobro|me pag|me pagais|se cobra))\b/.test(
      message
    ) &&
    !paymentTiming
  )
    tags.push("salary", "payment", "commercial");
  // Timing del pago -> liquidación (ver comentario de `paymentTiming` arriba).
  if (paymentTiming) tags.push("settlement", "payment", "revenue-share");
  // Hueco jun-2026: "esto me cuesta algo?" / "tengo que pagar o invertir?" pregunta si la CANDIDATA paga
  // (distinto de "cuanto me pagais", que es salary). Respuesta: no hay coste para ella -> faq-no-cost-to-join.
  // Guard (revisor 20-jul): si el coste es de un ÍTEM concreto (el iphone/móvil que le piden, un editor, el
  // alquiler, el pasaje...), NO es la pregunta de "¿me cuesta a mí ENTRAR?" -> lo lleva su ficha (device, etc.),
  // no no-cost. "me cuesta caro el iphone que me piden" iba a no-cost por la rama genérica "me cuesta".
  const costAboutSpecificItem =
    /\b(iphone|i phone|movil|celu|celular|telefono|samsung|galaxy|programa|editor|software|camara|alquiler|pasaje|contador)\b/.test(
      message
    );
  if (
    (/\b(me cuesta|cuesta algo|cuesta dinero|tengo que pagar|tengo que poner|hay que pagar|hay que poner|debo pagar|pagar para (?:entrar|empezar|trabajar)|invertir|inversion|es gratis|sale gratis|cuota|matricula|inscripcion|me cobrais|cobrais algo|me cobras|tengo que invertir|poner dinero|coste para mi)\b/.test(
      message
    ) ||
      // "¿no me sale muy caro (para arrancar)?" = miedo a un coste de entrada -> faq-no-cost-to-join. Anclado
      // ESTRICTAMENTE a "caro para arrancar/entrar/sumarme/esto...": el barrido adversarial 20-jul mostró que
      // "me sale caro" suelto disparaba con alquiler/iphone/pasaje/contador/editor (coste de OTRA cosa) y con
      // "el 70/30 es caro" (objeción de reparto, la maneja el planner). Así solo salta el miedo al coste de ENTRAR.
      (/\bcaro para (?:arrancar|empezar|entrar|meterme|unirme|sumarme|sumar|esto|entrada|hacer esto)\b/.test(message) &&
        !/\b(70|30|reparto|porcentaje|comision|split)\b/.test(message))) &&
    !costAboutSpecificItem
  )
    tags.push("no-cost", "cost", "faq");
  if (/\b(porcentaje|comision|reparto|cuanto os quedais)\b/.test(message)) tags.push("percentage", "revenue-share", "commercial");
  // La CIFRA preguntada sin la palabra "porcentaje/reparto" (barrido 19-jul, Ale: "de cuanto seria la parte de
  // la agencia?"): sin esto el retriever no traia la ficha comercial -> se marcaba "sin cobertura" y escalaba
  // en vez de dar el 70/30. El planner ya la reconoce como pregunta de cifra (asksExactFigureUnambiguous).
  if (/\b(la parte (de la agencia|vuestra|suya)|de cuanto (porcentaje|reparto))\b/.test(message))
    tags.push("percentage", "revenue-share", "commercial");
  if (/\b(70\/30|quien recibe|quien se queda)\b/.test(message)) tags.push("percentage", "revenue-share");
  if (/\b(por que.*70|porque.*70|porcentaje.*alto|os quedais.*70)\b/.test(message)) tags.push("why-70", "percentage", "services");
  // "liquidan"/"transferencia"/"como hacen los pagos" (barrido 18-jul: la pregunta del METODO de pago
  // quedaba sin ruta y recibia un "Perfecto"): misma respuesta de settlement/pagos.
  if (
    /\b(skrill|liquidacion|liquidar?|liquidan|cada 14|14 dias|neto|comision de la plataforma|transferencia|como (?:me )?(?:hacen|haceis|hacés) los pagos|los pagos como)\b/.test(
      message
    )
  )
    tags.push("settlement", "skrill", "payment", "revenue-share");
  // LATAM/coloquial del cobro ("¿cómo me llega la plata?"): misma respuesta de settlement/pagos.
  // (Barrido 3-jul: acababa en "mi socio" con la respuesta documentada delante.) Guard 20-jul: "invertir/
  // poner/gastar plata" es el GASTO de la candidata (-> no-cost), no el cobro; no dispara liquidación.
  if (
    /\b(plata|me llega (?:la plata|el dinero|el pago)|como (?:me llega|recibo) )\b|\bcomo me llega\b/.test(message) &&
    !/\b(invertir|poner|gastar|meter|aportar|desembols\w*)\b[^.!?]{0,10}\b(plata|dinero|guita)\b/.test(message)
  )
    tags.push("settlement", "payment", "salary");
  // Negociacion del reparto -> % + sensitive + revision humana (invariante 3). OJO: "me dais"/"dame" eran un
  // FALSO POSITIVO grave con "me dais info" / "dame info / detalles" (peticion GENERICA de info, el primer
  // mensaje tipico): le pegaba el % + sensitive, surfaceaba el 70/30 (riesgo invariante 3) y, al haber
  // answerFacts, desactivaba el opener canonico -> OpenAI lo reformulaba sin pedir el nombre (bug Alex 23-jun).
  // "me dais"/"dame" solo cuentan como negociacion si NO es una peticion de info; "me dais un 40% / mas",
  // "negociar", "excepcion" y cualquier cifra "\d%" siguen disparando negociacion (deteccion intacta).
  // El guard de info NO aplica si la frase tambien menciona reparto/negociacion ("me dais mas info sobre el
  // reparto / si me subis algo"): ahi sigue siendo negociacion, alineado con el planner (sin asimetria).
  const giveMeIsInfoRequest =
    /\b(me dais|dame)\b/.test(message) &&
    /\b(info|informacion|detalle|detalles)\b/.test(message) &&
    !/\b(reparto|porcentaje|comision|negociar|excepcion|sub[ei]\w*|mejor|me llevo|para mi)\b/.test(message);
  if ((/\b(me dais|dame|negociar|negociamos|excepcion)\b/.test(message) && !giveMeIsInfoRequest) || /\b\d{1,3}\s?%/.test(message))
    tags.push("percentage", "revenue-share", "sensitive", "negotiation");
  // El pitch de servicios salta por "servicios/que haceis/estrategia", o por "trafico"/"monetizacion" SOLO
  // si no es tránsito (trafficTransit) ni una pregunta de definición (asksDefinition = glosario). Barrido
  // 20-jul: "eso del trafico que es" recibía el pitch (5 tags) en vez de la definición; "el trafico en el
  // centro" (tránsito) también. Ambos casos ya no disparan el pitch.
  if (
    /\b(que haceis|que hace la agencia|servicios|estrategia)\b/.test(message) ||
    (!asksDefinition && ((/\btrafico\b/.test(message) && !trafficTransit) || /\bmonetizacion\b/.test(message)))
  )
    tags.push("services", "agency", "strategy", "traffic", "monetization");
  // GLOSARIO (barrido 19-jul, Marta 45: "que es monetizar? y que es un chatter?" -> el bot le re-soltaba el
  // pitch entero sin DEFINIR el termino). Cuando pide el SIGNIFICADO de una palabra de la jerga, se sirve la
  // definicion llana (ficha glossary-*), no el pitch. `asksDefinition` se calcula arriba (lo consulta también
  // el pitch de servicios). Se exige esa PISTA definitoria para no disparar el glosario cada vez que la
  // palabra aparezca en contexto.
  if (asksDefinition) {
    if (/\bmonetiz\w*/.test(message)) tags.push("glossary-monetizar");
    if (/\bchatt?ers?\b|\bchatting\b/.test(message)) tags.push("glossary-chatter");
    if (/\btrafico\b/.test(message)) tags.push("glossary-trafico");
  }
  // El pitch operativo ("cual es su forma de trabajar?", "como me promocionan?") es la pregunta
  // mas matadora de leads cuando se deriva al socio: debe recuperar SIEMPRE la entrada de servicios.
  if (
    /\bcomo trabaj|\bcomo se trabaja\b|\bforma de trabajar\b|\ben que consiste\b|\bque (?:me )?ofrec|\bcomo (?:me |la )?promocion|\bcomo (?:lo|la|se) manej|\bme la gestionen\b|\bcomo seria el trabajo\b|\bde que (?:se )?(?:trata|va)\b|\bme explicas\b|\bexplicame\b|\bme cuentas\b|\bcuentame (?:mas|un poco|como|de que)\b|\bde que se trata\b/.test(
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
  // Alineado con asksUnsupportedSpecificQuestion del planner: "que tengo que hacer yo / que me toca /
  // que tendria que hacer" tambien preguntan por la parte de la modelo. Sin esto el retriever no surfacea
  // la entrada y el planner lo marcaba "sin cobertura" -> escalaba a Alex (hueco anotado 15-jun).
  if (
    /\b(que hago yo|que tengo que hacer|que tendria que hacer|que me toca|que hay que hacer|mi parte|modelo|contenido|crear contenido|enviar contenido|drive)\b/.test(
      message
    )
  )
    tags.push("model-responsibilities", "content");
  // PREGUNTA DE MENORES/TERCEROS EN EL CONTENIDO ("¿mis hijos salen en las fotos?"), en AMBOS ordenes
  // (sujeto→verbo y verbo→sujeto: "¿salen mis hijos...?", "¿van a salir mis nenes...?" — inversion que cazo
  // el revisor del Lote C). Compartida por el guard del calendario y la regla de menores para que no
  // diverjan: si es pregunta de menores, el NO rotundo lidera; si solo MENCIONA hijos sin verbo de
  // aparecer ("tengo dos hijos, ¿cuantas fotos al dia?"), el calendario responde con normalidad.
  const MINORS_SUBJECT = "(?:mis?\\s+)?(?:hijos?|hijas?|nenes?|nenas?|ninos?|ninas?|bebes?|familia|pareja|novio|marido)";
  const APPEAR_VERB = "(?:salen?|salgan?|saldran?|saldria|van?\\s+a\\s+salir|salir|aparec\\w*)";
  // Tambien verbos de CREACION ("¿puedo grabar contenido con mi hija?") — bloqueante del revisor 18-jul:
  // al quitarle a la ficha del NO el tag generico "content" (que la hacia salir como ruido), estos fraseos
  // sin verbo de aparecer perdian la red y el bot contestaba responsabilidades ("tu grabas y lo mandas"),
  // un SI implicito. La ruta dedicada cubre ahora ambos ordenes tambien para crear/grabar/mandar.
  const CREATE_VERB = "(?:grab\\w*|hac\\w*|hag[oa]|cre[oa]\\w*|mand\\w*|envi\\w*|sub\\w*)";
  const minorsAppearQuestion =
    new RegExp(`\\b${MINORS_SUBJECT}\\b[^.!?]{0,30}\\b${APPEAR_VERB}\\b`).test(message) ||
    new RegExp(`\\b${APPEAR_VERB}\\b[^.!?]{0,30}\\b${MINORS_SUBJECT}\\b`).test(message) ||
    new RegExp(
      `\\b${CREATE_VERB}\\b[^.!?]{0,30}\\b(?:contenido|fotos?|videos?)\\b[^.!?]{0,30}\\bcon\\s+${MINORS_SUBJECT}\\b`
    ).test(message) ||
    new RegExp(`\\bcon\\s+${MINORS_SUBJECT}\\b[^.!?]{0,30}\\b(?:contenido|fotos?|videos?)\\b`).test(message) ||
    /\bsolo salgo yo\b|\bsale alguien mas\b|\baparece alguien mas\b/.test(message);
  // Guard de EDICION y de MENORES (Lote C 10-jul): "¿las fotos las edito yo o vosotros?" pregunta por la
  // EDICION y "¿mis hijos salen en las fotos?" por los MENORES — sin los guards, los tags de calendario
  // enterraban esas respuestas y se contestaba un volcado de dias/reels (R9-3; el de menores era el peor:
  // a una madre se le respondia "2 o 3 fotos diarias" en vez del NO rotundo — bloqueante del revisor).
  // Reutilizar material ANTIGUO ("fotos viejas que ya tengo") vs volumen DIARIO de produccion ("cuantas
  // fotos nuevas subo por dia"): comparten "fotos". Si hay pista de VOLUMEN, gana produccion; si no, y hay
  // pista de material viejo, gana material-antiguo (barrido adversarial 20-jul: "aunque tenga fotos viejas,
  // cuantas nuevas subo por dia" es volumen, no reutilizacion).
  const oldMaterialCue =
    /\b(viejas|antiguas|viejos|antiguos|que ya tengo|que tengo hech\w*|reutilizar|ya cread[oa]s?|ya hech[oa]s?|material viejo|contenido viejo)\b/.test(
      message
    );
  const volumeQuestion =
    /\b(cuantas|cuantos)\b[^.!?]{0,25}\b(fotos|reels|videos|subo|subir|nuevas|nuevos|al dia|por dia|diari\w*)\b/.test(message) ||
    /\b(por dia|al dia|diari\w*|a la semana|semanal\w*)\b/.test(message);
  if (
    /\b(reels|fotos|dias iniciales|cuantas fotos|cuantos reels)\b/.test(message) &&
    !/\bedit\w*|\bedicion\b|\bretoc\w*|\bretoques?\b/.test(message) &&
    !minorsAppearQuestion &&
    (!oldMaterialCue || volumeQuestion)
  )
    tags.push("production", "reels", "photos", "warmup");
  // Tiempo de dedicacion / compaginar / media jornada: se responde SOLO si pregunta (decision de Alex):
  // "con unas horas al dia es suficiente, lo importante es cumplir el contenido". Guard: "cuanto tiempo"
  // tambien aparece en el plazo de LANZAMIENTO ("en cuanto tiempo estaria lanzada la cuenta"): ahi es
  // launch-timeline, no dedicacion (barrido 20-jul). Se excluye el contexto de lanzamiento.
  // DEDICACIÓN (horas/jornada) vs LANZAMIENTO (plazo hasta estar lista) comparten "cuanto tiempo". La pista
  // fuerte de dedicación (horas/dedicar/jornada) manda: "una vez LANZADA la cuenta, cuantas horas dedico" es
  // dedicación; "en cuanto tiempo estaria lanzada" es lanzamiento (barrido adversarial 20-jul).
  const dedicationCue = /\b(horas|cuantas horas|dedic\w*|le dedico|jornada|compaginar|media jornada|al dia)\b/.test(message);
  const launchContext =
    /\b(lanzad\w*|lanzamiento|se lanza|este? lista|cuenta (?:lista|activa|en marcha|funcionando)|dejar (?:todo )?listo|listo para arrancar|tardan? en (?:dejar|tener|estar))\b/.test(
      message
    );
  if (
    /\b(media jornada|jornada completa|cuanto tiempo|cuantas horas|horas al dia|horas a la semana|compaginar|otro trabajo|otro curro|cuanto hay que dedicar|cuanto tengo que dedicar|cuanto le dedico|le puedo dedicar|tiempo le dedico)\b/.test(
      message
    ) &&
    // Solo se suprime la dedicación si es contexto de lanzamiento SIN pista de dedicación (si pregunta por
    // horas/dedicar aunque mencione "lanzada", sigue siendo dedicación).
    !(launchContext && !dedicationCue)
  )
    tags.push("availability", "time-commitment");
  if (
    /\b(publicado antes|publicar antes|nuevo|material antiguo|contenido antiguo|ya creado|reutilizar|sexting|viejos videos|fotos viejas|fotos antiguas|material viejo|videos viejos|contenido viejo|fotos que ya tengo|que ya tengo hech\w*|fotos que tengo)\b/.test(
      message
    ) &&
    // Si la pregunta es de VOLUMEN diario ("cuantas nuevas subo por dia"), gana produccion, no reutilizacion.
    !volumeQuestion
  ) {
    tags.push("old-material", "new-content", "onlyfans", "instagram");
  }
  if (
    /\b(limites|no quiero hacer|contenido anal|desnudo|juguetes|muy fuertes?|videos?[^.!?]{0,12}fuertes?|explicito|hardcore|hasta donde|es porno|pornografia|contenido sexual)\b/.test(
      message
    )
  )
    tags.push("boundaries", "limits", "content");
  // "me puedes llamar anita" / "llamame X" / "me llaman X" = ponerle un APODO, NO la llamada de telefono. El
  // verbo "llamar" usado para NOMBRAR surfaceaba el conocimiento de la llamada por WhatsApp y el bot proponia
  // agendar a mitad de la cualificacion (bug Alex 24-jun). "llamada/telefono/whatsapp" y un "llamar" que NO sea
  // para nombrar siguen contando como call/schedule.
  const callIsNaming =
    /\b(me\s+puedes\s+llamar|puedes\s+llamarme|me\s+podeis\s+llamar|ll[aá]mame|llamame|me\s+llaman|me\s+dicen|me\s+puedes\s+decir|me\s+digas)\b/.test(
      message
    );
  if (/\b(llamada|telefono|whatsapp)\b/.test(message) || (/\bllamar\b/.test(message) && !callIsNaming))
    tags.push("call", "schedule");
  // PREGUNTA de FORMATO de la llamada ("¿es videollamada o telefono?", "¿cuanto dura?", "¿de que va?") -> ficha
  // neutral call-format-neutral (Alex 20-jul: "es telefono"). Detector ESTRECHO: NO capta una PETICION de llamada
  // ("podemos hacer una llamada?", "cuando me llamas?"), que sigue difiriendo al socio pre-aprobacion (inv. 4).
  const callFormatQuestion =
    /\bvideo ?llamada\b/.test(message) ||
    /\bes por (?:video|telefono)\b/.test(message) ||
    /\bla llamada es\b[^.!?]{0,25}\b(?:por )?(?:video|telefono|como)\b/.test(message) ||
    (/\bllamada\b/.test(message) &&
      (/\b(?:cuanto dura|cuanto tarda|es larga|es corta|dura mucho|cuanto tiempo dura)\b/.test(message) ||
        /\b(?:de que|para que|sobre que|de q)\b[^.!?]{0,25}\b(?:va|trata|hablamos|me hablan|me van a hablar|hab)/.test(message)));
  // Guard (revisor 20-jul): si hay un CUÁNDO/horario ("a que hora / cuando / el martes / mañana / ya mismo"),
  // es una pregunta de AGENDA (no de formato) -> difiere al socio pre-aprobacion, no responde el formato.
  const asksWhenSchedule =
    /\b(cuando|a que hora|que hora|el (?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)|manana|hoy|ya mismo|esta (?:tarde|noche|semana)|el finde)\b/.test(
      message
    );
  if (callFormatQuestion && !asksWhenSchedule) tags.push("call-format");
  if (/\b(grabar|grabacion|transcribir|transcripcion|retell)\b/.test(message))
    tags.push("retell", "recording", "transcript", "consent");
  if (/\b(contrato|legal|clausula|permanencia)\b/.test(message)) tags.push("contract", "legal", "human-review");
  if (/\b(preaviso|finalizar|terminar|contenido autorizado|dejar la agencia)\b/.test(message))
    tags.push("termination", "content-rights", "legal-review");
  if (/\b(como funciona|proceso|que pasos)\b/.test(message)) tags.push("faq", "process", "how-it-works");
  // "raro" como desconfianza es "esto es raro / suena raro / medio raro", NO "NADA raro" (descriptor benigno:
  // "es nada raro, tranqui", auditoría 15-jul) ni "CONTRATO raro / cláusula rara" (preocupación contractual
  // benigna, que debe escalar a Alex por la ruta de contrato, NO soltar el boilerplate de transparencia;
  // auditoría 16-jul). Se excluyen ambos; "es raro / suena raro / no me fío" siguen siendo desconfianza.
  // Solo los sustantivos que SÍ tienen ruta contractual (línea ~223: contrato/clausula/permanencia): así al
  // excluir "raro" de distrust, GANA la escalada de contrato a Alex. No se incluyen "condiciones/letra pequeña"
  // (no enrutan a contrato), para no dejar el turno sin ficha (NOTA del revisor 16-jul).
  const contractualRaro =
    /\b(contrato|clausula\w*|permanencia)\b[^.?!]{0,25}\braro\b/.test(message) ||
    /\braro\b[^.?!]{0,15}\b(contrato|clausula\w*|permanencia)\b/.test(message);
  const suspiciousRaro = /(?<!nada )\braro\b/.test(message) && !contractualRaro;
  if (/\b(desconfianza|duda|no me fio|estafa|enfadada|enfado)\b/.test(message) || suspiciousRaro)
    tags.push("distrust", "objection", "human-intervention", "scam", "anger");
  // "¿cuántas chicas llevan?" (roster) y "¿cuántos seguidores tendré?" (crecimiento IG): tenían respuesta de
  // Alex pero no ruta -> se surfaceaba una ficha equivocada (tiempos de lanzamiento) = non-sequitur (auditoría
  // 15-jul). Ahora enrutan a sus FAQ dedicadas (faq-roster-size / faq-followers-range).
  if (
    /\b(cuantas (?:chicas|modelos|mujeres|personas|chavalas)|cuanta gente|cuantas (?:lleva|llevais|llevan|manejais|manejan|sois|teneis|tienen))\b/.test(
      message
    )
  )
    tags.push("roster", "faq");
  if (
    /\b(cuantos seguidores|seguidores (?:voy a|tendre|tendria|se consiguen|se llega|llega|tiene)|cuanto (?:crece|sube)|cuantos followers|\bfollowers\b)\b/.test(
      message
    )
  )
    tags.push("followers", "results", "faq");
  // Sin "requirement": esa etiqueta tambien marca la politica de cara y provocaba volcadas de
  // conocimiento no pedidas (sermon de la cara ante "tengo iPhone 14 Pro").
  if (/\b(iphone|i phone|android|movil|celu|celular|telefono necesito|samsung|galaxy|s23|s24|s25)\b/.test(message))
    tags.push("iphone", "galaxy", "device", "quality");
  if (/\b(ia|inteligencia artificial|bot|asistente virtual)\b/.test(message)) tags.push("ai", "identity", "transparency");
  if (/\b(no responde|seguimiento|volver a escribir|insistir)\b/.test(message)) tags.push("follow-up", "decline", "limited");
  if (
    /\b(lanzamiento|lanzar|lanzais|lanzad\w*|cuando empiezo|cuando empezamos|cuando empezariamos|cuando empezaria|cuando arrancamos|cuando se lanza|cuanto tarda|tardan? en (?:dejar|tener|estar)|dejar (?:todo )?listo|listo para arrancar|30 dias|semanas)\b/.test(
      message
    ) &&
    // "cuanto tarda" también aparece en el TIMING del pago ("cuanto tarda en caerme la plata"): ahí es
    // liquidación, no lanzamiento. paymentTiming (calculado arriba) evita ese cruce (barrido 20-jul).
    !paymentTiming &&
    // Y si hay pista de DEDICACIÓN (horas/dedicar aunque mencione "lanzada"), es dedicación, no lanzamiento.
    !dedicationCue
  )
    tags.push("launch", "timeline", "warmup");
  if (/\b(paises|que pais|vendeis|venden|mercado|compradores|poder adquisitivo)\b/.test(message))
    tags.push("countries", "market", "faq");
  // Pregunta por la GEOGRAFIA de las candidatas ("¿trabajan fuera de Argentina?", "¿aceptan de Colombia?",
  // "¿solo Espana?"): recupera la FAQ de paises para RESPONDER (las candidatas pueden ser de cualquier pais
  // hispano; el publico comprador es el espanol). Antes se ignoraba y se pedia el siguiente dato (Alex 22-jun).
  if (
    /\bfuera de (aqui|mi pais|argentin|colombi|mexic|venezuel|chile|peru|espan)/.test(message) ||
    /\btrabaj\w+\b[^.!?]{0,18}\b(argentin|colombi|mexic|venezol|chile|peru|latam|fuera|otro pais|otros paises|extranjer)/.test(
      message
    ) ||
    /\b(aceptan|admiten|cogen|buscan)\b[^.!?]{0,18}\b(argentin|colombi|mexic|venezol|chile|peru|de otro pais|extranjer|fuera)/.test(
      message
    ) ||
    /\bsolo (con )?espan/.test(message)
  )
    tags.push("countries", "market", "faq");
  // "Trabajais con trafico de Espana?" / "el trafico es espanol?" pregunta por el MERCADO objetivo,
  // no por el pitch operativo: debe recuperar la FAQ de paises (publico espanol, poder adquisitivo)
  // y no contestar con la entrada corporativa why-70 (r3 T18). Excluye el conflicto multi-agencia.
  if (
    /\btrafico\b[^.!?]{0,20}\b(espan|espana|espanol|argentin|colombian|latam|paises?|pais)\b/.test(message) ||
    /\b(espan|espanol)\w*\b[^.!?]{0,15}\btrafico\b/.test(message)
  ) {
    tags.push("countries", "market", "faq");
  }
  if (/\b(seleccion|requisitos para entrar|como entro|que buscais)\b/.test(message)) tags.push("selection", "process", "faq");
  // Quien abre / como se abre la cuenta de OnlyFans ("¿la abro yo o vosotros?", "¿cómo abro la cuenta de OF?",
  // "¿me la creáis/montáis?"): la abre la candidata (Alex 23-jun). Antes escalaba a Alex por falta de cobertura.
  // Guard: una "cuenta de banco/bancaria" (sin OF) NO es esto -> no surfacea la respuesta de la cuenta de OF.
  // Guard 2 (revisor 20-jul): "no me lo/la creo" = INCREDULIDAD (creer), no CREAR la cuenta -> el stem "cre"
  // colisiona crear/creer; se excluye la incredulidad negada para no enrutar "no me lo creo" a quién-abre-OF.
  if (
    !/\bcuenta (?:de |del )?banc/.test(message) &&
    !/\bno me l[ao] cre[eoy]/.test(message) &&
    (/\b(abr(?:o|ir|is|imos|e|en)|crea|crear|creais|crean|monta|montar|montais|montan|arma|armar|armais|arman|prepara|preparar|preparais|preparan|configura|configurar|configurais|configuran|quien abre|me la abr|me la cre|me la mont|me la arm|me la prepar)\b[^.!?]{0,25}\b(cuenta|onlyfans|of)\b/.test(
      message
    ) ||
      /\b(cuenta|onlyfans|of)\b[^.!?]{0,25}\b(?:la abro|lo abro|la creo|lo creo|me (?:la|lo) (?:abr|arm|cre|mont|prepar|configur)\w*|quien (?:la|lo) abre|tengo que abrir|hay que abrir|la abro o)\b/.test(
        message
      ) ||
      // Ronda 3 (18-jul, spec de Alex — el defer jamás para lo que se sabe): "yo NO TENGO OnlyFans, ¿eso
      // cómo sería?" preguntaba justo esto (cómo se arranca sin cuenta) y acababa en "te lo confirmo por
      // WhatsApp" porque ninguna ruta casaba sin verbo de crear. La respuesta está aprobada (la creas tú,
      // te guiamos).
      // "ni idea"/"no se como" anclado a CÓMO FUNCIONA (barrido adversarial 20-jul: "no tengo OF y ni idea de
      // que precio ponerle" NO es onboarding, es precio de suscripción). Se exige "como va/funciona/se hace...".
      /\b(?:no tengo|nunca tuve|nunca he tenido|todavia no tengo|aun no tengo)\b[^.!?]{0,15}\b(?:onlyfans|only fans|of|cuenta)\b[^.!?]{0,40}\b(?:como (?:seria|funciona|se hace|hago|arranco|empiezo|va)|que (?:hago|tengo que hacer)|eso como|no se (?:como|por donde)|ni idea de como)\b/.test(
        message
      ))
  )
    tags.push("of-account", "account-setup", "onboarding", "faq");
  // DICTADA POR ALEX (18-jul): "¿qué (tipo de) contenido debo enviarte?" / "¿cuánto contenido?" / "¿qué me
  // pides para comenzar?" -> la ficha de referencias y guiones (content-what-to-send). Antes caía en la del
  // perfil objetivo ("no hace falta experiencia...") — un non-sequitur visto en conversaciones REALES.
  if (
    // "q"/"m" son las abreviaturas reales de IG ("y q m pides para comenzar" — caso Daiana).
    /\b(?:que|q|cuanto|cuanta|cual) (?:tipo de )?contenido\b[^.!?]{0,35}\b(?:enviar|enviarte|enviaros|mandar|mandarte|subir|hacer|pedis|pides|piden|necesitan?|hace falta)\b|\b(?:que|q|cuanto) contenido\b|\bq(?:ue)?\s+(?:me?\s+)?(?:pides|piden|pedis|necesitas|necesitan)\b[^.!?]{0,25}\b(?:para (?:comenzar|empezar|arrancar)|contenido)\b/.test(
      message
    )
  )
    tags.push("content", "what-to-send", "faq");
  // Hueco jun-2026: "que edad buscais?" -> franja objetivo (perfil maduro, ~30-50). Pregunta sobre la edad
  // del PUBLICO objetivo; no toca el corte de mayoria de edad (invariante 2 vive en candidate-requirements-adult).
  if (
    /\b(que edad|edad buscais|edades|que edades|hasta que edad|limite de edad|edad minima|edad maxima|soy (?:muy |demasiado )?mayor|muy mayor|demasiado mayor|sirve mi edad|importa la edad|por mi edad|por la edad)\b/.test(
      message
    )
  )
    tags.push("age", "target-profile", "selection", "faq");
  // Dudas de ENCAJE que NO nombran "edad/mayor" pero suelen serlo: "es demasiado?" tras decir la edad,
  // "sirvo/valgo para esto", "estoy a tiempo", "soy demasiada para vosotros", "demasiado/muy mayor/grande/vieja".
  // Surfacea el perfil objetivo para RESPONDERLAS (decision de Alex: el bot contesta antes de avanzar) en vez de
  // saltar al siguiente dato. Guardado para NO pisar "es mucho dinero?" (dinero, no encaje). Bridge determinista
  // (Alex 24-jun) hasta que la relevancia la decida el LLM (Pieza 1).
  if (
    /\b(sirvo|valgo)\b[^.!?]{0,18}\b(para esto|para vosotros|para vos|a mi edad|aqui)\b|\bestoy a tiempo\b|\b(demasiad[oa]|much[oa]|muy)\s+(mayor|grande|vieja)\b|\b(soy|sere|seria)\s+(demasiad[oa]|much[oa])\b[^.!?]{0,14}\b(para|edad|mayor|vieja|esto|vosotros|vos)\b|\b[2-5]\d\b[^.!?]{0,15}\b(demasiad[oa]|much[oa])\b/.test(
      message
    )
  )
    tags.push("age", "target-profile", "selection", "faq");
  // "me bloqueo / me han bloqueado / me bloquearon / me dejo y me bloqueo": es SU historia personal
  // (alguien la bloqueo a ELLA), NO una pregunta de si se puede bloquear un pais. Sin este guard, la
  // palabra "bloqueo" (normalizada de "bloqueó") disparaba la respuesta enlatada de geo-bloqueo a una
  // pregunta que nunca hizo (re-sonda 4-jul, caso Romy: "me dejo sola y despues me bloqueo"). "mi pais"
  // sigue siendo red independiente para una peticion legitima que use "me bloqueen a los de mi pais".
  const blockedByThirdParty =
    /\b(?:me|te|la|lo|nos|le|les)\s+(?:ha\s+|han\s+|habia\s+|hubiera\s+|hubieran\s+)?bloque(?:o|a|an|aron|ado|ada|aban)\b/.test(
      message
    );
  const asksAboutBlocking = !blockedByThirdParty && /\b(bloquear|bloqueo|bloqueen|bloquea)\b/.test(message);
  if (
    asksAboutBlocking ||
    /\b(que no me vean|me reconozcan|me vea alguien|privacidad|anonimato|mi pais|conocidos)\b/.test(message) ||
    // Tambien "no quiero que (en X) me vean", "que me vean en mi pais", "me vea aqui": misma duda de privacidad
    // geografica (Alex 22-jun) que antes se ignoraba y se trataba como simple "mirarlo con calma".
    /\bno quiero que\b[^.!?]{0,30}\bme\s+vea/.test(message) ||
    /\bme\s+vean?\b[^.!?]{0,15}\b(en|aqui|mi pais|argentin|colombi|mexic|venezol|chile|peru)\b/.test(message) ||
    /\b(en|aqui|mi pais)\b[^.!?]{0,15}\bme\s+vea/.test(message) ||
    // Caso REAL Lilly (prod, 20-jul): "mi perfil solo muestra AFUERA? no me gustaria ACCESO de LATAM" -> vacio
    // -> el bot rellenaba con chatter/pitch. No quiere ser accesible/visible en su region (latam/su pais); la
    // quiere solo visible AFUERA (publico español). Es geo-privacy-three-layers (el trafico se dirige a España).
    // acceso anclado a término geo (no "aca/aqui" sueltos: "no tengo acceso a internet aca" NO es esto).
    /\bacceso\b[^.!?]{0,15}\b(latam|latinoamerica|argentin|mi pais|mi region|de aca|de aqui|desde aca|desde mi pais)\b/.test(
      message
    ) ||
    /\bno (?:me gustaria|quiero|querria|me gusta)\b[^.!?]{0,18}\bacceso\b/.test(message) ||
    // "no quiero que se vea EN <región>" -> geo. Anclado a objeto geo (revisor 20-jul: "no quiero que se vea
    // mi cara" NO es geo, es la ficha de la CARA; sin este ancla geo se la robaba).
    /\bno (?:me gustaria|quiero|querria|me gusta)\b[^.!?]{0,25}\b(?:se vea|se muestre|me vean|visible|llegue|aparezca)\b[^.!?]{0,15}\b(en |aqui|aca|mi pais|mi region|latam|argentin|de aca|por aca)\b/.test(
      message
    ) ||
    // "(perfil/cuenta/contenido) solo <VISIBILIDAD> afuera" -> geo. Exige verbo de VISIBILIDAD (no "solo la
    // uso fuera de casa" / "solo se sube fuera de horario", revisor 20-jul).
    /\b(perfil|cuenta|contenido)\b[^.!?]{0,18}\b(solo|unicamente|nada mas)\b[^.!?]{0,18}\b(muestr\w*|se vea|se vean|vean|visible|aparec\w*)\b[^.!?]{0,10}\b(afuera|fuera|exterior|espana)\b/.test(
      message
    ) ||
    /\bmuestr\w*\b[^.!?]{0,10}\b(afuera|fuera|exterior)\b/.test(message) ||
    // "mi zona" quitado (colisión con "fuera de mi zona de confort", revisor 20-jul).
    /\bfuera de (?:latam|mi pais|argentin|mi region|aca)\b/.test(message) ||
    /\b(se vea|me vean|me vea|lo vean|vean)\b[^.!?]{0,15}\b(en espana|solo afuera|solo fuera|nada mas afuera|unicamente afuera)\b/.test(
      message
    )
  )
    tags.push("geo-privacy", "privacy", "country-block", "objection");
  // Miedo a que la RECONOZCA gente concreta (familia, conocidos, pareja, jefe): es una duda de privacidad,
  // no un dato. Anclado a un verbo de ver/reconocer/enterarse para no disparar con cualquier "familia".
  if (
    /\b(?:me|nos)\s+(?:vea|vean|ve|ven|viera|vieran|reconozca|reconozcan|reconoce|reconocen|entere|enteren|entera|enteran|pille|pillen|pilla|pillan|descubra|descubran|descubre|descubren)\b[^.!?]{0,30}\b(familia|conocid\w*|gente|amig\w*|hermano|hermana|padre|madre|novio|pareja|jefe|trabajo|vecin\w*)\b/.test(
      message
    ) ||
    /\b(familia|gente conocida|alguien conocido|conocidos|amig\w*)\b[^.!?]{0,30}\b(me|nos)\s+(?:vea|vean|ve|ven|reconozca|reconozcan|reconoce|entere|enteren|entera|pille|pilla|descubr\w*)\b/.test(
      message
    )
  )
    tags.push("geo-privacy", "privacy", "objection");
  // Nombre artístico / no usar su nombre real ("¿puedo usar otro nombre?"): la identidad de las cuentas
  // la crea la agencia (española) — misma respuesta de privacidad (barrido 3-jul).
  // "otra historia/identidad con mis fotos" (caso real Daiana 18-jul): misma respuesta de identidad.
  // "otra historia" SOLO con contexto de identidad cerca (fotos/imagen/cuenta/nombre): el modismo
  // "eso ya es otra historia" soltaba la politica de identidad sin venir a cuento (revisor 18-jul).
  if (
    /\b(otro nombre|nombre falso|nombre artistico|mi nombre real|sin mi nombre|con mi nombre|otra identidad|identidad falsa)\b/.test(
      message
    ) ||
    /\botra historia\b[^.!?]{0,30}\b(?:fotos?|imagen|cara|cuenta|nombre|perfil|mia?)\b/.test(message) ||
    /\b(?:fotos?|imagen|cuenta|nombre|perfil)\b[^.!?]{0,30}\botra historia\b/.test(message)
  )
    tags.push("geo-privacy", "privacy");
  // Fraseos que piden OCULTAR el rostro SIN nombrar "cara" (barrido 19-jul, Priscila: "se puede tapar?",
  // "no hay forma de taparla", "difuminar" — el retriever los perdia porque no llevan "cara/rostro" y rotaba
  // fichas ajenas en bucle turno tras turno). La ficha ya responde de frente ("no es posible trabajar sin
  // mostrar la cara") y el guard factual prohibe prometer taparla, asi que servirla aqui es lo correcto, no un
  // "sermon de la cara": la candidata lo esta pidiendo. Los verbos de ocultacion en un DM de captacion
  // conciernen al rostro; "no mostrar/no se vea" se ancla a cara/rostro para no confundir con otros datos.
  if (
    /\b(cara|rostro|anonima|anonimo|sin mostrarme|sin ensenarme)\b/.test(message) ||
    /\b(tapar|taparla|taparme|taparse|taparlo|ocultar\w*|disimular|difumin\w*|pixel\w*|desenfocar)\b/.test(message) ||
    /\bno (?:mostrar|ensenar)(?:me)?(?: la cara| el rostro| mi cara)\b/.test(message) ||
    /\b(?:que )?no se (?:me )?vea (?:la cara|el rostro|mi cara)\b/.test(message)
  )
    tags.push("face", "anonymity", "requirement");
  // Solo si la mencion no es negada: "no trabajo con otra agencia" es un dato, no una objecion.
  // Y solo si NO es el relato en PASADO de una agencia que dejo (barrido 18-jul, caso Daiana: "la otra
  // agencia me chamuyo con only... lo deje" disparaba la ficha de multi-agencia y el bot le preguntaba
  // "¿son de trafico espanol las otras agencias?" a alguien SIN agencias). Los verbos de pasado van
  // ANCLADOS a "agencia" en ambos ordenes (revisor 18-jul: "entre"/"estuve" sueltos mataban casos
  // PRESENTES como "trabajo con dos agencias, entre ellas una de mexico").
  // Tambien una QUEJA en PASADO de una agencia (comparacion: "la otra agencia era un afano/un desastre",
  // "se llevaba una barbaria", "no me traian trafico", "me prometieron y no cumplieron") NO es una pregunta
  // de multi-agencia: es su mal recuerdo (/loop 20-jul, caso Carla "con la otra agencia era un afano" ->
  // recibia "puedes trabajar con dos agencias..."). Ancladas a PASADO ("era/fue/se llevaba/me prometieron")
  // para no matar el caso PRESENTE ("ahora estoy con una agencia, me tienen abandonada"), que si es relevante.
  const pastAgencyStory =
    /\b(?:deje|sali de|me fui de|no segui|entre a|estuve en|me metieron en|me mandaron a|me chamuy\w*|me engan\w*|me estafaron)\b[^.!?]{0,30}\bagencias?\b/.test(
      message
    ) ||
    /\bagencias?\b[^.!?]{0,45}\b(?:la deje|lo deje|deje al toque|me chamuy\w*|me metieron|me mandaron|me engan\w*|me estafaron|me dejaron tirad\w*|me dejo tirad\w*|me trataron mal|me cagaron|un horror|hace \d+ (?:mes|meses|semanas?|anos?))\b/.test(
      message
    ) ||
    /\b(?:otra |la |una |esa )agencias?\b[^.!?]{0,45}\b(?:era un\w*|fue un\w*|me tenia\w* abandonad\w*|no me (?:traia\w*|trajo|trajeron)|se llevaba|me prometi\w*|me chamuy\w*|me engan\w*|un desastre|un afano|un asco|un espanto|un choreo|una porqueria)\b/.test(
      message
    ) ||
    // La QUEJA en pasado tambien PRECEDE a "agencia" ("fue una experiencia horrible con la otra agencia, me
    // dejaron tirada"): barrido adversarial 20-jul.
    /\b(?:experiencia (?:horrible|mala|pesima|nefasta|de terror|espantosa)|un horror|me dejaron tirad\w*|me trataron (?:re )?mal|me cagaron|una estafa|un afano|un desastre)\b[^.!?]{0,45}\bagencias?\b/.test(
      message
    );
  if (
    /\b(otra agencia|otras agencias|dos agencias|multi ?agencia|otra empresa)\b/.test(message) &&
    !/\b(?:no|nunca|jamas)\b[^.!?]{0,30}\bagencias?\b/.test(message) &&
    !pastAgencyStory
  )
    tags.push("multi-agency", "agencies", "market-conflict");
  if (/\b(no uso instagram|no tengo instagram|no subo fotos|no uso redes)\b/.test(message))
    tags.push("agency-responsibilities", "instagram", "operations");
  // Propiedad/control de la cuenta de IG ("¿la cuenta es mía o vuestra?") y quién habla con los clientes
  // ("¿quién contesta los mensajes?"): respuestas documentadas de servicios/operaciones (barrido 3-jul).
  if (
    /\bcuenta\b[^.!?]{0,25}\b(mia|tuya|vuestra|de quien|de ustedes)\b|\bde quien es la cuenta\b/.test(message) ||
    /\b(quien|quienes)\b[^.!?]{0,20}\b(contesta|responde|habla|chatea)\b[^.!?]{0,25}\b(mensajes?|clientes?|fans?|suscriptores?|chats?)\b/.test(
      message
    ) ||
    /\bchatters?\b/.test(message)
  )
    tags.push("services", "agency", "agency-responsibilities", "instagram", "operations");
  // (Lote C sweep R9, decisiones de Alex 10-jul) Cuatro respuestas directas nuevas:
  // OF previo abandonado/sin usar ("tengo of pero abandonado, ¿cuenta igual?") -> sin problema, se retoma.
  if (
    // Anclado a OF/cuenta (revisor Lote C): "mi INSTAGRAM lo tengo parado" no es el OF abandonado.
    /\b(?:of|onlyfans|only fans)\b[^.!?]{0,30}\babandonad\w*|\babandonad\w*\b[^.!?]{0,25}\b(?:of|onlyfans|cuenta)\b|\b(?:el of|el onlyfans|la cuenta)\b[^.!?]{0,15}\b(?:lo|la) tengo (?:parad[oa]|muert[oa]|abandonad[oa])\b|\b(?:lo|la) tengo (?:parad[oa]|muert[oa]|abandonad[oa])\b(?=[^.!?]{0,20}\b(?:of|onlyfans|cuenta)\b)|\bcuenta (?:vieja|parada|muerta|abandonada)\b|\b(?:of|onlyfans)\b[^.!?]{0,20}\b(?:parad[oa]|muert[oa]|sin usar|sin tocar)\b|\b(?:of|onlyfans|only fans)\b[^.!?]{0,30}\b(?:lo|la)\s+(?:deje|abandone|deje de lado|deje tirad\w+|deje colgad\w+|deje muert[oa])\b|\b(?:abri|cree|hice|tengo|tenia|arme)\b[^.!?]{0,25}\b(?:of|onlyfans|only fans)\b[^.!?]{0,45}\bnunca\b[^.!?]{0,15}\b(?:subi|use|toque|publique|entre|active|la use|le puse)\w*\b|\b(?:of|onlyfans|only fans|cuenta de of|cuenta de onlyfans|mi of|el of)\b[^.!?]{0,20}\b(?:esta )?limpi[oa]\b/.test(
      message
    )
  )
    tags.push("onlyfans", "existing-account", "eligibility");
  // ¿Quién EDITA las fotos/los vídeos? -> la agencia (ella manda el material en crudo). "retoc*" ANCLADO a
  // contenido (revisor Lote C: "me he retocado los labios" es cirugia estetica, no edicion).
  if (
    /\bedit(?:o|as|a|ais|an|ar|arlo|arla|arlas|amos)?\b[^.!?]{0,25}\b(?:fotos?|videos?|contenido|material|yo|vosotros|ustedes)\b|\b(?:fotos?|videos?|contenido|material)\b[^.!?]{0,25}\b(?:edit\w*|edicion|retoc\w*|retoques?)\b|\b(?:edicion|retoques?)\b[^.!?]{0,25}\b(?:fotos?|videos?|contenido|material|haceis|hacemos|vosotros|ustedes|quien)\b|\bquien (?:edita|hace la edicion)\b|\bla edicion\b/.test(
      message
    )
  )
    tags.push("editing", "production", "content");
  // ¿Oficina física o todo online? -> 100% online.
  if (/\boficina\b|\bpresencial\w*\b|\bvuestra sede\b|\b(?:es|todo|sois|trabajais) online\b/.test(message))
    tags.push("location", "online", "agency");
  // ¿Mis HIJOS/terceros salen en el contenido? -> NO rotundo (solo ella; menores JAMAS). Usa la MISMA
  // deteccion `minorsAppearQuestion` que el guard del calendario (ambos ordenes, ver arriba). La OBJECION
  // de pareja ("mi novio no (me) deja/quiere que salga") NO entra (revisor Lote C): eso es una preocupacion
  // de pareja hacia ELLA, no la pregunta de quien aparece.
  if (minorsAppearQuestion && !/\bno (?:me\s+|le\s+)?(?:quiere|gusta|deja|permite|dejaria)\b/.test(message))
    tags.push("minors-content", "only-her", "content", "safety");
  // ¿De qué OS ENCARGÁIS? / ¿Qué HARÍAIS por mí? / ¿Qué hacéis vosotros? (sweep R9 10-jul: LA pregunta de
  // venta — el pitch operativo — se defería a WhatsApp x2 hasta que la candidata protestaba "ya me lo
  // dijiste"). Fraseo en 2ª persona/condicional hacia la AGENCIA -> servicios/operaciones. Mismos guards
  // que la regla de gestión: sin dinero (control de pagos escala) y sin petición de pruebas.
  if (
    (/\b(?:de que |que )?(?:os|se) encarg\w+\b/.test(message) ||
      /\bque (?:hariais|harian|haceis|hacen|hace la agencia|pone la agencia)\b/.test(message) ||
      /\bvuestra parte\b|\bvuestro trabajo\b/.test(message)) &&
    // cobr\w* cubre "cobros/cobrar" (revisor R9: "os encargais de los cobros" es tesoreria -> escala, no servicios).
    !/\b(?:dinero|pago|pagos|plata|cobr\w*|reparto|porcentaje|comision)\b/.test(message) &&
    // demostrar/demuestr: "que haceis para DEMOSTRAR que no es estafa" es desconfianza/escalado, no servicios.
    !/\b(?:ensena\w*|ensename|muestr\w*|mostr\w*|ver|veas|envi\w*|mand\w*|pasa\w*|pasame|resultados?|ejemplos?|pruebas?|demostrar|demuestr\w*)\b/.test(
      message
    )
  )
    tags.push("services", "agency", "agency-responsibilities", "operations");
  // ¿Quién GESTIONA/lleva/maneja el Instagram/la cuenta? (barrido 8-jul: "y eso quién lo gestiona" se
  // defería como desconocido siendo que lo gestiona la AGENCIA). Se surfacea servicios/operaciones. Guardado:
  // un verbo de gestión + un término de cuenta/IG y SIN dinero (para no pisar el control de pagos, que escala).
  if (
    /\b(?:gestiona|gestionan|gestionais|lleva|llevan|llevais|maneja|manejan|manejais|administra|administran|administrais|se encarga|se encargan|controla|controlais)\b/.test(
      message
    ) &&
    /\b(?:instagram|insta|cuenta|cuentas|perfil|perfiles|redes|la pagina)\b/.test(message) &&
    !/\b(?:dinero|pago|pagos|plata|cobro|reparto|porcentaje|comision)\b/.test(message) &&
    // NO cuando declara OTRA agencia ("otra agencia ya gestiona mi cuenta"): eso lo lidera la entrada de
    // multi-agencia, no la de servicios (evita un desplazamiento de ranking que noto el revisor 8-jul).
    !/\b(?:otra agencia|otras agencias|otro estudio|otra empresa|otro manager|otro representante)\b/.test(message) &&
    // NO es una PETICION DE PRUEBAS ("enseñame/muestrame las cuentas que llevais para ver resultados"): esas
    // ESCALAN a revision humana (podrian exponer cuentas de otras clientas), no se responden como servicios.
    !/\b(?:ensena\w*|ensename|muestr\w*|mostr\w*|ver|veas|envi\w*|mand\w*|pasa\w*|pasame|resultados?|ejemplos?|pruebas?)\b/.test(
      message
    )
  )
    tags.push("services", "agency", "agency-responsibilities", "instagram", "operations");
  // Identidad / ubicación de la agencia ("¿dónde estáis?", "¿de dónde sois?", "¿de qué agencia sos?",
  // "¿de qué empresa?", "¿para quién trabajas?"): perfil de agencia (Rose Models, española). Antes "de qué
  // agencia sos" no casaba -> knowledgeEntries vacío -> uncovered por el token "agencia" -> HIR (auditoría
  // 15-jul). Ahora surfacea la ficha agency-profile-rose-models y se responde "Soy Alex, de Rose Models".
  if (
    /\b(donde (?:estais|estan|esta la agencia|trabajais)|de donde (?:sois|son)|ubicad\w*|ubicacion de la agencia|de que agencia|que agencia (?:es|sos|sois|son|eres|es esta)|de que empresa|para quien trabaj\w*|quien(?:es)? (?:sois|son|es) (?:la )?agencia)\b/.test(
      message
    )
  )
    // Se pushea "agency"/"rose-models" (ambas en agency-profile), NO "identity": esa tag la comparte la ficha
    // AI-transparency (la del "¿eres un bot?"), que escala a HIR — y "de qué agencia sos" NO debe escalar. La
    // pregunta de bot la surfacea su propio regex (línea ~236). (auditoría 15-jul: "identity" colaba HIR aquí.)
    tags.push("agency", "rose-models");
  // Verificación de la cuenta de OnlyFans ("¿me verifico con mi DNI?", "no pude verificar mi OF, me da
  // error"): ficha DEDICADA de ayuda a la verificación (faq-of-verification-help), no la de quién abre la
  // cuenta. Se empujan sus tags propios "verification"/"reassurance" para que gane a faq-who-opens-of-account,
  // que comparte of-account/onboarding y antes se colaba por word-overlap (barrido 20-jul).
  if (
    /\b(verificar|verificacion|verificarme|dni|documento de identidad)\b[^.!?]{0,30}\b(onlyfans|of|cuenta)\b/.test(message) ||
    /\b(onlyfans|of)\b[^.!?]{0,30}\b(verificar|verificacion|dni)\b/.test(message)
  )
    tags.push("of-account", "account-setup", "onboarding", "verification", "reassurance", "faq");
  if (/\b(pruebas|demostrar|demuestren|demuestra|resultados de otras|otras modelos|garantias)\b/.test(message))
    tags.push("distrust", "objection");
  // PETICION DE PRUEBAS sensibles (capturas del panel de ganancias, backend, "muestrame cuentas que
  // llevais"): es material/datos sensibles. Decision de Alex 19-jun: SIEMPRE escalar a el (el bot se para
  // y le llega un WhatsApp); el bot nunca inventa ni promete capturas. -> tag human-intervention.
  const proofRequest =
    /\b(capturas?|pantallazos?|panel de ganancias|backend|acceso real)\b/.test(message) ||
    // Verbos AMPLIADOS (QA 26-jun): no solo "muestrame/me muestras" sino "me pueden/podeis/podrian mostrar o
    // ensenar cuentas/perfiles/resultados". Mensaje real que se escapaba: "me pueden mostrar cuentas que manejen?".
    /\b(muestrame|muestrenme|ensename|ensenenme|mostrarme|ensenarme|quiero ver|puedo ver|me ensenas|me muestras|(?:me\s+)?(?:pueden|podeis|podrian|podrias|podria|podemos|podriais)\s+(?:mostrar|ensenar|ver|pasar))\b[^.!?]{0,40}\b(cuentas?|perfiles?|ganancias?|resultados?|modelos? que (?:llev|manej|gestion)|pruebas?)\b/.test(
      message
    );
  if (proofRequest) tags.push("proof-request", "human-intervention", "distrust");
  // MECANICA DEL DINERO / TESORERIA ("eres tu la que recibe los pagos?", "el dinero pasa por vosotros?"):
  // el dinero lo controla la modelo (cobra ella en su cuenta via OF y abona a la agencia), pero confirmarlo
  // por chat es justo donde Alex no quiere que el bot improvise. Decision de Alex 19-jun: escalar a el (para
  // el bot + WhatsApp). NO confundir con "cuanto/cuando me pagais" (eso sigue su ruta comercial normal).
  const paymentControl =
    /\b(quien|tu|vosotros|ustedes|la agencia)\b[^.!?]{0,25}\b(recib\w+|cobr\w+|gestion\w+|maneja\w*)\b[^.!?]{0,20}\b(dinero|pago|pagos|cobros|plata|pasta)\b/.test(
      message
    ) ||
    /\b(el dinero pasa por|donde (?:llega|va) (?:el )?dinero|a quien le? llega (?:el )?dinero|recib\w+ vosotros (?:el )?dinero)\b/.test(
      message
    );
  if (paymentControl) tags.push("payment-control", "human-intervention");
  if (/\b(telegram|twitter|videollamadas|otras redes)\b/.test(message)) tags.push("traffic", "telegram", "twitter", "services");

  // --- Fase 1a batch 2 (barrido 20-jul): tipos de pregunta REALES que quedaban sin ficha (nulo -> el
  // motor los trataba como "sin cobertura" y deferia). Todos enrutan a fichas YA aprobadas; no se inventa
  // contenido. Anclados para no crear falsos positivos. ---
  // "¿tengo que viajar/desplazarme/mudarme a Espana?" -> todo es online, no hay que moverse.
  if (
    // Anclado a CONTEXTO de trabajo/lugar: "viajar/desplazarme/mudarme" a España / la oficina / para
    // trabajar. NO el smalltalk "me gusta viajar" (sería un no-sequitur -> ficha de "todo online").
    /\b(viajar|desplaz\w+|mudar\w+|mudarme|trasladar\w*)\b[^.!?]{0,25}\b(a espana|en espana|alla|a la oficina|para (?:trabajar|el trabajo|laburar)|por (?:el )?(?:trabajo|laburo)|ahi|alli)\b/.test(
      message
    ) ||
    /\b(?:tengo que|hay que|debo|hace falta)\b[^.!?]{0,20}\b(?:viajar|desplaz\w+|mudar\w+|ir a espana|estar (?:ahi|alli|en espana)|presentarme|ir presencial\w*|ir a la oficina)\b/.test(
      message
    ) ||
    /\b(ir|estar|presentarme|presencia)\b[^.!?]{0,20}\b(a espana|en espana|a la oficina|en persona|presencial\w*)\b/.test(message)
  )
    tags.push("location", "online", "agency");
  // "¿me dan un adelanto/anticipo para arrancar?" -> no hay salario fijo ni adelantos, va por reparto.
  // "adelanto/anticipo" ES un sustantivo ambiguo (verbo "me adelanto", "el adelanto" de una serie, "por
  // adelantado" de cortesía): el barrido adversarial 20-jul cazó 6 falsos positivos. Se exige contexto de
  // DINERO/pago o el verbo "me dan/pagan/hay ... un adelanto".
  if (
    /\b(?:adelanto|anticipo)\b[^.!?]{0,15}\b(?:plata|dinero|guita|sueldo|paga|pagar|cobrar|para arrancar|para empezar|inicial|mensual|de guita|de plata)\b/.test(
      message
    ) ||
    /\b(?:plata|dinero|guita|sueldo|un fijo|paga|algo)\b[^.!?]{0,12}\b(?:de |como )?(?:adelanto|anticipo)\b/.test(message) ||
    /\b(?:me (?:dais|dan|darian|dieran)|hay|pagan|dan un)\b[^.!?]{0,10}\b(?:adelanto|anticipo)\b/.test(message) ||
    /\bpaga inicial\b/.test(message) ||
    /\bun fijo para (?:arrancar|empezar)\b/.test(message)
  )
    tags.push("salary", "commercial", "payment");
  // "¿necesito experiencia previa?" -> no hace falta experiencia (perfil objetivo).
  if (
    /\b(experiencia previa|hace falta experiencia|tener experiencia|sin experiencia|con experiencia|nunca (?:hice|he hecho) esto|soy primeriza|soy novata|nunca trabaje (?:de |en )esto)\b/.test(
      message
    )
  )
    tags.push("target-profile", "selection", "faq");
  // "¿necesito (tener muchos) seguidores?" -> no hace falta, el trafico lo pone la agencia (perfil objetivo).
  if (/\b(necesito|hace falta|tengo que tener|hay que tener|debo tener|se necesitan?)\b[^.!?]{0,20}\bseguidores\b/.test(message))
    tags.push("target-profile", "selection", "faq");
  // "¿puedo monetizar/usar mi Instagram personal?" -> la agencia crea cuentas propias para el trafico; su
  // IG personal es aparte. Ancla "personal/propio/mio" + IG (no pisa "monetizar" a secas, que es glosario/pitch).
  if (
    /\b(?:monetizar|usar|usa|aprovechar|con)\b[^.!?]{0,20}\b(?:mi )?(?:instagram|insta|ig|cuenta)\b[^.!?]{0,15}\b(personal|propi[oa]|mi[oa]|que ya tengo|actual)\b/.test(
      message
    ) ||
    /\bmi (?:instagram|insta) personal\b/.test(message)
  )
    tags.push("agency-responsibilities", "instagram", "operations", "services");
  // "¿qué proceso hacen para ELEGIR/escoger a las chicas?" -> proceso de seleccion (no el generico how-it-works).
  if (
    /\b(elegir|escoger|seleccionar|eligen|escogen|elegis|para elegir|como eligen)\b[^.!?]{0,25}\b(chicas|modelos|candidatas|mujeres|gente|a quien)\b/.test(
      message
    )
  )
    tags.push("selection", "process", "faq");

  if (input.intent === "ASKS_ABOUT_PERCENTAGE") tags.push("percentage", "revenue-share");
  // FIX 2 + 3 (Alex 22-jun): el modelo en vivo a veces etiqueta como ASKS_ABOUT_CONTRACT una pregunta
  // benigna (proceso, "como funciona", o una ACLARACION de un termino que el propio bot uso, p.ej. "que es
  // eso de la liquidacion/los pagos"). Forzar aqui las etiquetas contractuales (que arrastran la entrada HIR
  // contract-questions-human-review) ESCALABA esas preguntas (WhatsApp + pausa) sin motivo. Ahora SOLO se
  // fuerza la escalada contractual cuando hay una especificacion contractual GENUINA en el mensaje
  // (contrato/clausula/permanencia/exclusividad/firmar/salir/baja...). Una aclaracion de pago/proceso ya NO
  // escala: la recuperan sus propios tags (settlement/payment para "liquidacion", proceso para "como va") y
  // se responde con la respuesta ACTIVA. Las dudas contractuales reales con palabra clave tambien las capta
  // la linea de mensaje de arriba (contract/legal/human-review), asi que la escalada genuina no se debilita.
  if (input.intent === "ASKS_ABOUT_CONTRACT" && hasGenuineContractSpecifics(message))
    tags.push("contract", "legal", "human-review");
  if (input.intent === "REQUESTS_CALL") tags.push("call", "schedule");

  // Varias reglas empujan el mismo tag (p. ej. "percentage" por "porcentaje" y por un "%" numerico).
  // scoreEntry suma +1.4 por cada coincidencia, asi que sin deduplicar una entrada puntuaria doble.
  return [...new Set(tags)];
}

// Especificaciones contractuales GENUINAS: terminos legales concretos o salida/compromiso de la
// relacion. Su presencia mantiene SIEMPRE la escalada contractual, aunque el mensaje tambien hable de
// "proceso" (una baja/terminacion disfrazada de "que pasos hay para salir?" sigue siendo contractual).
const genuineContractSpecificsPattern =
  /\b(contrato|contractual|clausula|permanencia|exclusividad|firmar|terminos legales|legal|abogad|preaviso|penalizacion|salir|salirme|dejar|dejarlo|baja|darme de baja|desvincul|terminar|finalizar|rescind|compromiso|comprometer|obligan|obligacion|tiempo minimo)\b/;

function hasGenuineContractSpecifics(message: string): boolean {
  return genuineContractSpecificsPattern.test(message);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
