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

  if (
    /\b(sueldo|salario|fijo|paga|pagan|pagais|pagais|pagaria|pagariais|me pagariais|pagarian|pagaran|pagos|cobro|cobrar|cobraria|cobrarias|ganaria|cuanto se gana|cuanto gano|cuando (?:me )?pag|cuando (?:cobro|cobraria|se cobra|se paga)|cada cuanto (?:cobro|pagais|se paga|me pagais)|como (?:cobro|me pag|me pagais|se cobra))\b/.test(
      message
    )
  )
    tags.push("salary", "payment", "commercial");
  // Hueco jun-2026: "esto me cuesta algo?" / "tengo que pagar o invertir?" pregunta si la CANDIDATA paga
  // (distinto de "cuanto me pagais", que es salary). Respuesta: no hay coste para ella -> faq-no-cost-to-join.
  if (
    /\b(me cuesta|cuesta algo|cuesta dinero|tengo que pagar|tengo que poner|hay que pagar|hay que poner|debo pagar|pagar para (?:entrar|empezar|trabajar)|invertir|inversion|es gratis|sale gratis|cuota|matricula|inscripcion|me cobrais|cobrais algo|me cobras|tengo que invertir|poner dinero|coste para mi)\b/.test(
      message
    )
  )
    tags.push("no-cost", "cost", "faq");
  if (/\b(porcentaje|comision|reparto|cuanto os quedais)\b/.test(message)) tags.push("percentage", "revenue-share", "commercial");
  if (/\b(70\/30|quien recibe|quien se queda)\b/.test(message)) tags.push("percentage", "revenue-share");
  if (/\b(por que.*70|porque.*70|porcentaje.*alto|os quedais.*70)\b/.test(message)) tags.push("why-70", "percentage", "services");
  if (/\b(skrill|liquidacion|liquidar?|cada 14|14 dias|neto|comision de la plataforma)\b/.test(message))
    tags.push("settlement", "skrill", "payment", "revenue-share");
  // LATAM/coloquial del cobro ("¿cómo me llega la plata?"): misma respuesta de settlement/pagos.
  // (Barrido 3-jul: acababa en "mi socio" con la respuesta documentada delante.)
  if (/\b(plata|me llega (?:la plata|el dinero|el pago)|como (?:me llega|recibo) )\b|\bcomo me llega\b/.test(message))
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
  if (/\b(que haceis|que hace la agencia|servicios|trafico|estrategia|monetizacion)\b/.test(message))
    tags.push("services", "agency", "strategy", "traffic", "monetization");
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
  const minorsAppearQuestion =
    new RegExp(`\\b${MINORS_SUBJECT}\\b[^.!?]{0,30}\\b${APPEAR_VERB}\\b`).test(message) ||
    new RegExp(`\\b${APPEAR_VERB}\\b[^.!?]{0,30}\\b${MINORS_SUBJECT}\\b`).test(message) ||
    /\bsolo salgo yo\b|\bsale alguien mas\b|\baparece alguien mas\b/.test(message);
  // Guard de EDICION y de MENORES (Lote C 10-jul): "¿las fotos las edito yo o vosotros?" pregunta por la
  // EDICION y "¿mis hijos salen en las fotos?" por los MENORES — sin los guards, los tags de calendario
  // enterraban esas respuestas y se contestaba un volcado de dias/reels (R9-3; el de menores era el peor:
  // a una madre se le respondia "2 o 3 fotos diarias" en vez del NO rotundo — bloqueante del revisor).
  if (
    /\b(reels|fotos|dias iniciales|cuantas fotos|cuantos reels)\b/.test(message) &&
    !/\bedit\w*|\bedicion\b|\bretoc\w*|\bretoques?\b/.test(message) &&
    !minorsAppearQuestion
  )
    tags.push("production", "reels", "photos", "warmup");
  // Tiempo de dedicacion / compaginar / media jornada: se responde SOLO si pregunta (decision de Alex):
  // "con unas horas al dia es suficiente, lo importante es cumplir el contenido".
  if (
    /\b(media jornada|jornada completa|cuanto tiempo|cuantas horas|horas al dia|horas a la semana|compaginar|otro trabajo|otro curro|cuanto hay que dedicar|cuanto tengo que dedicar|cuanto le dedico|le puedo dedicar|tiempo le dedico)\b/.test(
      message
    )
  )
    tags.push("availability", "time-commitment");
  if (
    /\b(publicado antes|publicar antes|nuevo|material antiguo|contenido antiguo|ya creado|reutilizar|sexting|viejos videos)\b/.test(
      message
    )
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
  if (/\b(grabar|grabacion|transcribir|transcripcion|retell)\b/.test(message))
    tags.push("retell", "recording", "transcript", "consent");
  if (/\b(contrato|legal|clausula|permanencia)\b/.test(message)) tags.push("contract", "legal", "human-review");
  if (/\b(preaviso|finalizar|terminar|contenido autorizado|dejar la agencia)\b/.test(message))
    tags.push("termination", "content-rights", "legal-review");
  if (/\b(como funciona|proceso|que pasos)\b/.test(message)) tags.push("faq", "process", "how-it-works");
  if (/\b(desconfianza|duda|no me fio|raro|estafa|enfadada|enfado)\b/.test(message))
    tags.push("distrust", "objection", "human-intervention", "scam", "anger");
  // Sin "requirement": esa etiqueta tambien marca la politica de cara y provocaba volcadas de
  // conocimiento no pedidas (sermon de la cara ante "tengo iPhone 14 Pro").
  if (/\b(iphone|i phone|android|movil|telefono necesito|samsung|galaxy|s23|s24|s25)\b/.test(message))
    tags.push("iphone", "galaxy", "device", "quality");
  if (/\b(ia|inteligencia artificial|bot|asistente virtual)\b/.test(message)) tags.push("ai", "identity", "transparency");
  if (/\b(no responde|seguimiento|volver a escribir|insistir)\b/.test(message)) tags.push("follow-up", "decline", "limited");
  if (
    /\b(lanzamiento|lanzar|lanzais|cuando empiezo|cuando empezamos|cuando empezariamos|cuando empezaria|cuando arrancamos|cuando se lanza|cuanto tarda|30 dias|semanas)\b/.test(
      message
    )
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
  if (
    !/\bcuenta (?:de |del )?banc/.test(message) &&
    (/\b(abr(?:o|ir|is|imos|e|en)|crea|crear|creais|crean|monta|montar|montais|montan|quien abre|me la abr|me la cre|me la mont)\b[^.!?]{0,25}\b(cuenta|onlyfans|of)\b/.test(
      message
    ) ||
      /\b(cuenta|onlyfans)\b[^.!?]{0,25}\b(la abro|la creo|me la abr|me la cre|me la mont|quien la abre|tengo que abrir|hay que abrir|la abro o)\b/.test(
        message
      ))
  )
    tags.push("of-account", "account-setup", "onboarding", "faq");
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
    /\b(en|aqui|mi pais)\b[^.!?]{0,15}\bme\s+vea/.test(message)
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
  if (/\b(otro nombre|nombre falso|nombre artistico|mi nombre real|sin mi nombre|con mi nombre)\b/.test(message))
    tags.push("geo-privacy", "privacy");
  if (/\b(cara|rostro|anonima|sin mostrarme|sin ensenarme)\b/.test(message)) tags.push("face", "anonymity", "requirement");
  // Solo si la mencion no es negada: "no trabajo con otra agencia" es un dato, no una objecion.
  if (
    /\b(otra agencia|otras agencias|dos agencias|multi ?agencia|otra empresa)\b/.test(message) &&
    !/\b(?:no|nunca|jamas)\b[^.!?]{0,30}\bagencias?\b/.test(message)
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
    /\b(?:of|onlyfans|only fans)\b[^.!?]{0,30}\babandonad\w*|\babandonad\w*\b[^.!?]{0,25}\b(?:of|onlyfans|cuenta)\b|\b(?:el of|el onlyfans|la cuenta)\b[^.!?]{0,15}\b(?:lo|la) tengo (?:parad[oa]|muert[oa]|abandonad[oa])\b|\b(?:lo|la) tengo (?:parad[oa]|muert[oa]|abandonad[oa])\b(?=[^.!?]{0,20}\b(?:of|onlyfans|cuenta)\b)|\bcuenta (?:vieja|parada|muerta|abandonada)\b|\b(?:of|onlyfans)\b[^.!?]{0,20}\b(?:parad[oa]|muert[oa]|sin usar|sin tocar)\b/.test(
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
  // Ubicación de la agencia ("¿dónde estáis?", "¿de dónde sois?"): perfil de agencia (española).
  if (
    /\b(donde (?:estais|estan|esta la agencia|trabajais)|de donde (?:sois|son)|ubicad\w*|ubicacion de la agencia)\b/.test(message)
  )
    tags.push("agency", "identity");
  // Verificación de la cuenta de OnlyFans ("¿me verifico con mi DNI?"): proceso documentado de apertura.
  if (
    /\b(verificar|verificacion|verificarme|dni|documento de identidad)\b[^.!?]{0,30}\b(onlyfans|of|cuenta)\b/.test(message) ||
    /\b(onlyfans|of)\b[^.!?]{0,30}\b(verificar|verificacion|dni)\b/.test(message)
  )
    tags.push("of-account", "account-setup", "onboarding", "faq");
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
