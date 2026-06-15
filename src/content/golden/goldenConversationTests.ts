import { GoldenConversationTestSchema, type GoldenConversationTestInput } from "@/domain/conversationExample";

// Fixtures basados en el funnel real (analisis de conversaciones 2026-06-10):
// la mayoria de candidatas son argentinas/colombianas de 21-43 que llegan por el CTA
// del anuncio ("¡Hola! Quiero más información."), con telefonos +54/+57. Se mantiene
// cobertura de formato espanol (telefono 612..., Madrid). Datos siempre inventados.
// Cada expectativa esta verificada contra el comportamiento real del motor: los golden
// describen lo que el sistema HACE y DEBE hacer, nunca comportamiento aspiracional.
const rawGoldenTests: GoldenConversationTestInput[] = [
  {
    id: "golden-initial-contact",
    title: "Primer contacto desde el anuncio (perfil publico): opener canonico sin preguntas",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["¡Hola! Quiero más información."],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["Rose Models"],
    responseMustNotInclude: ["Comprendo perfectamente", "Estimada candidata", "que edad tienes", "?"],
    responseRequirements: [
      "presentarse como Alex de Rose Models en el primer contacto",
      "validar el perfil y encuadrar preguntas rapidas + llamada",
      "ninguna pregunta de cualificacion antes del asentimiento"
    ],
    acceptableResponsePatterns: ["opener canonico de tres pasos sin pregunta"]
  },
  {
    id: "golden-initial-contact-assent",
    title: "Tras aceptar el marco del opener, la primera pregunta es el nombre",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["¡Hola! Quiero más información.", "Si, me parece bien"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["como te llamas"],
    responseMustNotInclude: ["Rose Models", "que edad tienes"],
    responseRequirements: ["el guion canonico arranca por el nombre, nunca por la edad"]
  },
  {
    id: "golden-ad-cta-profile-gate",
    title: "CTA del anuncio con cuenta privada: gate de perfil",
    initialCandidate: { profileVisibility: "PRIVATE" },
    stateBefore: "NEW_LEAD",
    messages: ["¡Hola! Quiero más información."],
    expectedTransition: "WAITING_PROFILE_ACCESS",
    responseMustIncludeAny: ["solicitud", "cuenta privada"],
    responseMustNotInclude: ["aprobada", "ingresos", "porcentaje"],
    responseRequirements: ["pedir aceptar la solicitud antes de explicar nada"]
  },
  {
    id: "golden-private-profile",
    title: "Cuenta privada",
    initialCandidate: { profileVisibility: "PRIVATE" },
    stateBefore: "NEW_LEAD",
    messages: ["Hola, me interesa"],
    expectedTransition: "WAITING_PROFILE_ACCESS",
    responseMustIncludeAny: ["cuenta privada", "solicitud"],
    responseMustNotInclude: ["aprobada", "ingresos"],
    responseRequirements: ["pedir acceso sin compromiso"]
  },
  {
    id: "golden-confirms-interest",
    title: "Candidata responde si, me interesa: opener primero y nombre tras el asentimiento",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Si, me interesa", "Vale, dale"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["como te llamas"],
    responseMustNotInclude: ["Gracias por ponerte en contacto"]
  },
  {
    id: "golden-provides-phone",
    title: "Da telefono directamente (formato espanol) tras el opener",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["¡Hola! Quiero más información.", "Mi telefono es 612 345 678"],
    expectedTransition: "QUALIFYING",
    expectedExtractedFields: { phone: "612345678" },
    responseMustIncludeAny: ["edad", "Perfecto"],
    responseMustNotInclude: ["llamo en dos minutos"]
  },
  {
    id: "golden-provides-phone-argentina",
    title: "Da telefono argentino con formato +54 tras el opener",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["¡Hola! Quiero más información.", "Mi telefono es +54 9 11 2345 6789"],
    expectedTransition: "QUALIFYING",
    expectedExtractedFields: { phone: "5491123456789" },
    responseMustIncludeAny: ["edad", "llamada"],
    responseMustNotInclude: ["dos minutos", "ahora mismo"],
    responseRequirements: ["seguir cualificando con el telefono ya extraido"]
  },
  {
    id: "golden-requests-call",
    title: "Pide llamada inmediata en el primer mensaje: opener canonico (la llamada ya esta en el marco)",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Me llamas y me lo explicas?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["llamada"],
    responseMustNotInclude: ["ahora mismo", "dos minutos"]
  },
  {
    id: "golden-percentage",
    title: "Pregunta del reparto: da el 70/30 y el porque, sin escalar",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Que porcentaje os quedais?"],
    expectedTransition: "QUALIFYING",
    // Decision de Alex (14-jun): preguntar el reparto SI da la cifra 70/30 + breve porque; nunca proactivo.
    responseMustIncludeAny: ["70%"],
    responseMustNotInclude: ["75", "garantizado", "socio", "consulto"]
  },
  {
    id: "golden-percentage-exact",
    title: "Pregunta la cifra exacta del reparto: 70/30 sin escalar",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Cual es el porcentaje exacto del reparto?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["70%"],
    responseMustNotInclude: ["socio", "consulto", "75", "garantiz"],
    responseRequirements: ["dar la cifra oficial 70/30 solo porque la pregunta es explicita", "no escalar a revision humana"]
  },
  {
    id: "golden-salary-or-percentage",
    title: "Pregunta generica salario o porcentaje: respuesta sin cifra",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Trabajan con salario fijo o porcentaje?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["reparto", "porcentaje"],
    responseMustNotInclude: ["70%", "30%", "70/30", "75", "garantiz"],
    responseRequirements: ["explicar que va por reparto sin mencionar la cifra"]
  },
  {
    id: "golden-salary-negotiation",
    title: "Negociacion de dinero garantizado: escalar a revision humana",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Quiero 500 USD garantizados al mes, podemos negociar el porcentaje?"],
    expectedTransition: "HUMAN_INTERVENTION_REQUIRED",
    responseMustIncludeAny: ["socio"],
    responseMustNotInclude: ["garantiz", "500", "70%", "75"],
    responseRequirements: ["no negociar por chat", "derivar la decision al socio"]
  },
  {
    id: "golden-underage-closed",
    title: "Menor de edad (17): cierre inmediato",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Tengo 17 años"],
    expectedTransition: "CLOSED",
    expectedExtractedFields: { age: 17 },
    responseMustIncludeAny: ["mayores de edad"],
    responseMustNotInclude: ["que edad tienes", "experiencia", "llamada"],
    responseRequirements: ["cerrar educadamente sin continuar el proceso"]
  },
  {
    id: "golden-distrust",
    title: "Candidata desconfiada",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["No se, me da un poco de desconfianza"],
    responseMustIncludeAny: ["entiendo", "calma", "pregunta"],
    responseMustNotInclude: ["confia", "garantizado"]
  },
  {
    id: "golden-already-answered",
    title: "Ya habia contestado una pregunta",
    initialCandidate: { profileVisibility: "PUBLIC", firstName: "Carla", age: 27 },
    stateBefore: "QUALIFYING",
    // Orden canonico del guion real: con nombre y edad conocidos, el siguiente slot es OF, no "ciudad".
    messages: ["Como te dije, tengo 27"],
    responseMustIncludeAny: ["has tenido of", "experiencia"],
    responseMustNotInclude: ["que edad tienes"]
  },
  {
    id: "golden-returning-lead",
    title: "Lead argentina vuelve despues de varios dias",
    initialCandidate: { profileVisibility: "PUBLIC", firstName: "Luz", age: 31, city: "Buenos Aires", country: "Argentina" },
    stateBefore: "QUALIFYING",
    messages: ["Perdona, recien veo tu mensaje, estuve a full estos dias"],
    responseMustIncludeAny: ["has tenido of", "experiencia", "disponibilidad"],
    responseMustNotInclude: ["empezamos de cero"]
  },
  {
    id: "golden-multiple-messages",
    title: "Varios datos en un mensaje (candidata argentina)",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Tengo 27, soy de Buenos Aires, tengo experiencia en redes, estoy disponible por las tardes y tengo iPhone 15"],
    expectedTransition: "WAITING_HUMAN_REVIEW",
    expectedExtractedFields: { age: 27, city: "Buenos Aires", country: "Argentina" },
    responseMustIncludeAny: ["socio", "valorarlo"],
    responseMustNotInclude: ["que edad tienes"]
  },
  {
    id: "golden-spanish-lead",
    title: "Cobertura de candidata espanola (Madrid)",
    initialCandidate: { profileVisibility: "PUBLIC", firstName: "Ana" },
    stateBefore: "QUALIFYING",
    messages: ["Tengo 24 y soy de Madrid"],
    expectedTransition: "QUALIFYING",
    expectedExtractedFields: { age: 24, city: "Madrid", country: "España" },
    responseMustIncludeAny: ["has tenido of", "experiencia"],
    responseMustNotInclude: ["que edad tienes"]
  },
  {
    id: "golden-colombian-lead",
    title: "Lead colombiana responde al anuncio: opener canonico primero",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Hola! Soy de Medellin, Colombia, me interesa la propuesta"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["Rose Models"],
    responseMustNotInclude: ["Comprendo perfectamente", "Estimada candidata", "que edad tienes"]
  },
  {
    id: "golden-argentinian-spanish",
    title: "Candidata escribe con espanol argentino",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Si, me interesa, vos me contas?", "Dale, contame"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["como te llamas"],
    responseMustNotInclude: ["vos ", "queres", "tenes"]
  },
  {
    id: "golden-human-request",
    title: "Solicita hablar con una persona",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Prefiero hablar con una persona"],
    expectedTransition: "HUMAN_INTERVENTION_REQUIRED",
    responseMustIncludeAny: ["reviso", "calma", "socio"],
    responseMustNotInclude: ["formulario"]
  }
];

export const goldenConversationTests = rawGoldenTests.map((test) => GoldenConversationTestSchema.parse(test));
