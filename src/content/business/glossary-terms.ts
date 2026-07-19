import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

// Glosario para candidatas que NO conocen la jerga (barrido 19-jul, caso Marta 45 anos: "que es
// monetizar? y que es un chatter?" -> el bot le RE-SOLTABA el pitch entero en vez de DEFINIR el
// termino). Son explicaciones en lenguaje llano de palabras que YA aparecen en el pitch ACTIVO
// ("monetizacion, trafico, equipo de chatters 24/7"), no politica nueva: no tocan %, ni servicios
// nuevos, ni compromisos. Cada termino es una entrada aparte con su propio tag para que se responda
// SOLO lo que pregunta (no un volcado de las tres definiciones). Alex pidio el arreglo ("es facil
// decir que es monetizar y que es un chatter"); si quiere afinar el texto a su voz, se reescribe.
const entries: KnowledgeEntryInput[] = [
  {
    id: "glossary-monetizar",
    category: "FAQ",
    title: "Que significa monetizar (explicacion sencilla)",
    facts: ["Monetizar es convertir la cuenta en ingresos: que el contenido genere dinero con los suscriptores."],
    approvedAnswerPoints: [
      "Monetizar es convertir tu cuenta en ingresos: nosotros nos encargamos de que el contenido genere dinero con los suscriptores, tu solo mandas el contenido."
    ],
    prohibitedClaims: ["Prometer una cantidad concreta de dinero o ingresos garantizados."],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: ["glossary", "glossary-monetizar"],
    requiresHumanReview: false,
    version: "glossary-monetizar-2026-07-19.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-19"
  },
  {
    id: "glossary-chatter",
    category: "FAQ",
    title: "Que es un chatter (explicacion sencilla)",
    facts: ["Un chatter es una persona del equipo que chatea con los clientes por la modelo; ella no habla con nadie."],
    approvedAnswerPoints: [
      "Un chatter es una persona de nuestro equipo que chatea con los clientes por ti para atenderlos y vender; tu no tienes que hablar con nadie."
    ],
    prohibitedClaims: [],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: ["glossary", "glossary-chatter"],
    requiresHumanReview: false,
    version: "glossary-chatter-2026-07-19.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-19"
  },
  {
    id: "glossary-trafico",
    category: "FAQ",
    title: "Que es el trafico (explicacion sencilla)",
    facts: ["El trafico es llevar seguidores y visitas hacia la cuenta; lo hace la agencia con cuentas de Instagram propias."],
    approvedAnswerPoints: [
      "El trafico es llevar seguidores y visitas hacia tu cuenta; lo hacemos nosotros con cuentas de Instagram que creamos, tu no tienes que conseguir seguidores."
    ],
    prohibitedClaims: [],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: ["glossary", "glossary-trafico"],
    requiresHumanReview: false,
    version: "glossary-trafico-2026-07-19.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-19"
  }
];

export const glossaryTermEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
