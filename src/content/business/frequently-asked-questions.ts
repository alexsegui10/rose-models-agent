import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "faq-how-it-works-covered",
    category: "FAQ",
    title: "Como funciona a nivel general",
    facts: [
      "Rose Models valora primero el perfil, recopila informacion basica y despues puede organizar una llamada para explicar los detalles."
    ],
    approvedAnswerPoints: [
      "Primero valoramos un poco el perfil.",
      "Si vemos que encaja, organizamos una llamada y lo explicamos con calma."
    ],
    prohibitedClaims: ["Aceptar automaticamente.", "Prometer resultados o ingresos."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["faq", "process", "how-it-works"],
    requiresHumanReview: false,
    version: "faq-how-it-works-2026-06-12.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-12"
  },
  {
    // Hueco confirmado por Alex (jun-2026): la candidata NO paga nada para trabajar con Rose Models.
    // Pregunta real frecuente ("esto me cuesta algo?", "tengo que invertir?"). Sin cifras (invariante 3).
    id: "faq-no-cost-to-join",
    category: "FAQ",
    title: "Trabajar con Rose Models no cuesta nada a la candidata",
    facts: [
      "Trabajar con Rose Models no tiene ningun coste para la candidata.",
      "La candidata no paga ninguna cuota, inscripcion ni inversion inicial para empezar.",
      "Rose Models gana unicamente a traves del reparto cuando la cuenta genera ingresos."
    ],
    approvedAnswerPoints: [
      "No tienes que pagar nada para trabajar con nosotros: no hay cuota ni inversion inicial.",
      "Nosotros solo ganamos cuando tu generas ingresos, a traves del reparto."
    ],
    prohibitedClaims: [
      "Pedir dinero por adelantado a la candidata.",
      "Pedir una cuota, fianza o inversion inicial.",
      "Prometer ingresos garantizados o dar cifras de ganancias."
    ],
    allowedStates: [
      "NEW_LEAD",
      "WAITING_PROFILE_ACCESS",
      "QUALIFYING",
      "APPROVED",
      "COLLECTING_CALL_DETAILS",
      "HUMAN_INTERVENTION_REQUIRED"
    ],
    tags: ["no-cost", "cost", "faq"],
    requiresHumanReview: false,
    version: "faq-no-cost-2026-06-20.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-20"
  },
  {
    // Hueco confirmado por Alex (23-jun-2026): la cuenta de OnlyFans la abre la CANDIDATA, no la agencia, y es
    // facil (crear la cuenta -> enlazar el banco -> verificarse). Antes "¿la abro yo o vosotros?" escalaba a Alex
    // por falta de cobertura. Sin cifras ni promesas (invariante 3); nunca pedir credenciales (invariante 5).
    id: "faq-who-opens-of-account",
    category: "FAQ",
    title: "Quien abre la cuenta de OnlyFans y como",
    facts: [
      "La cuenta de OnlyFans la abre la propia candidata, no la agencia.",
      "Abrir la cuenta es sencillo: se crea siguiendo los pasos que indica OnlyFans, se enlaza una cuenta bancaria y se completa la verificacion de identidad."
    ],
    approvedAnswerPoints: [
      "La cuenta de OnlyFans la abres tu, es muy facil.",
      "Solo creas la cuenta con los pasos que te indican, enlazas tu cuenta de banco y te verificas."
    ],
    prohibitedClaims: [
      "Decir que la agencia abre o gestiona el acceso a la cuenta de la candidata por ella.",
      "Pedir las credenciales o la contrasena de la cuenta de la candidata.",
      "Prometer ingresos o dar cifras de ganancias."
    ],
    allowedStates: ["QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["of-account", "account-setup", "onboarding", "faq"],
    requiresHumanReview: false,
    version: "faq-of-account-2026-06-23.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-23"
  }
];

export const frequentlyAskedQuestionEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
