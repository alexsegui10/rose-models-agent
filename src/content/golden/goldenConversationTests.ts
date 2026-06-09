import { GoldenConversationTestSchema, type GoldenConversationTestInput } from "@/domain/conversationExample";

const rawGoldenTests: GoldenConversationTestInput[] = [
  {
    id: "golden-initial-contact",
    title: "Primer contacto normal",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Hola, quiero informacion"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["edad", "experiencia", "ciudad"],
    responseMustNotInclude: ["Comprendo perfectamente", "Estimada candidata"],
    responseRequirements: ["mensaje breve", "una pregunta principal"],
    acceptableResponsePatterns: ["pregunta de cualificacion"]
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
    title: "Candidata responde si, me interesa",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Si, me interesa"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["edad"],
    responseMustNotInclude: ["Gracias por ponerte en contacto"]
  },
  {
    id: "golden-provides-phone",
    title: "Da telefono directamente",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Mi telefono es 612 345 678"],
    expectedTransition: "QUALIFYING",
    expectedExtractedFields: { phone: "612345678" },
    responseMustIncludeAny: ["edad", "Perfecto"],
    responseMustNotInclude: ["llamo en dos minutos"]
  },
  {
    id: "golden-requests-call",
    title: "Pide llamada inmediata",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Me llamas y me lo explicas?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["llamada", "edad"],
    responseMustNotInclude: ["ahora mismo", "dos minutos"]
  },
  {
    id: "golden-percentage",
    title: "Pregunta general de porcentaje",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "QUALIFYING",
    messages: ["Que porcentaje os quedais?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["reparto", "salario fijo", "llamada"],
    responseMustNotInclude: ["70%", "70/30", "garantizado"]
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
    initialCandidate: { profileVisibility: "PUBLIC", age: 22 },
    stateBefore: "QUALIFYING",
    messages: ["Como te dije, tengo 22"],
    responseMustIncludeAny: ["ciudad", "experiencia"],
    responseMustNotInclude: ["que edad tienes"]
  },
  {
    id: "golden-returning-lead",
    title: "Vuelve despues de varios dias",
    initialCandidate: { profileVisibility: "PUBLIC", age: 24, city: "Madrid" },
    stateBefore: "QUALIFYING",
    messages: ["Perdona, he estado liada estos dias"],
    responseMustIncludeAny: ["no pasa nada", "experiencia", "disponibilidad"],
    responseMustNotInclude: ["empezamos de cero"]
  },
  {
    id: "golden-multiple-messages",
    title: "Varios datos en un mensaje",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Tengo 23, soy de Madrid, tengo experiencia en redes, estoy disponible por las tardes y tengo iPhone 13"],
    expectedTransition: "WAITING_HUMAN_REVIEW",
    expectedExtractedFields: { age: 23, city: "Madrid" },
    responseMustIncludeAny: ["socio", "valorarlo"],
    responseMustNotInclude: ["que edad tienes"]
  },
  {
    id: "golden-argentinian-spanish",
    title: "Candidata escribe con espanol argentino",
    initialCandidate: { profileVisibility: "PUBLIC" },
    stateBefore: "NEW_LEAD",
    messages: ["Si, me interesa, vos me contas?"],
    expectedTransition: "QUALIFYING",
    responseMustIncludeAny: ["edad"],
    responseMustNotInclude: ["vos", "queres", "tenes"]
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
