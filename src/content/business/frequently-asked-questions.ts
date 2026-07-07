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
    // Solo cuando PREGUNTA como/quien abre. Si cuenta que NO PUDO verificar/activar, no recitar el paso a paso
    // (la deja peor): ahi se la tranquiliza con faq-of-verification-help. Bug real Paula 7-jul.
    mandatoryNuances: [
      "Solo explicar el paso a paso si la candidata PREGUNTA como o quien abre la cuenta.",
      "Si dice que NO pudo verificar/activar/validar su cuenta, no le sueltes 'es facil, la abres tu': tranquilizala con que la agencia la ayuda (faq-of-verification-help)."
    ],
    requiresHumanReview: false,
    version: "faq-of-account-2026-06-23.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-23"
  },
  {
    // Confirmado por Alex (7-jul-2026, caso real Paula): si a la candidata le cuesta VERIFICAR / VALIDAR /
    // ACTIVAR / abrir su cuenta de OnlyFans, la agencia la ACOMPAÑA y la ayuda a dejarla lista. En ese momento
    // NO se entra en el paso a paso tecnico (no es el momento): primero se la tranquiliza. Sin cifras ni promesas
    // (invariante 3); nunca pedir credenciales ni contraseñas (invariante 5).
    id: "faq-of-verification-help",
    category: "FAQ",
    title: "La agencia ayuda a verificar / activar la cuenta de OnlyFans",
    facts: [
      "Si a la candidata le cuesta verificar, validar, activar o dejar lista su cuenta de OnlyFans, la agencia la acompaña y la ayuda con eso.",
      "En ese momento no se le explica el paso a paso tecnico: primero se la tranquiliza y se le dice que ese tema lo veis vosotros con ella."
    ],
    approvedAnswerPoints: [
      "Tranquila, eso lo vemos nosotros y te ayudamos a dejarla lista.",
      "No te preocupes por la verificacion, te acompañamos con eso."
    ],
    prohibitedClaims: [
      "Decirle que lo tiene que resolver ella sola porque es facil, justo cuando ha dicho que no pudo.",
      "Explicarle el paso a paso tecnico de la verificacion en ese momento.",
      "Pedir las credenciales o la contraseña de su cuenta.",
      "Prometer ingresos o dar cifras de ganancias."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "APPROVED", "COLLECTING_CALL_DETAILS", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["of-account", "account-setup", "onboarding", "verification", "reassurance", "faq"],
    mandatoryNuances: [
      "No entrar en el paso a paso tecnico en ese momento: solo tranquilizar y ofrecer ayuda.",
      "Nunca pedir credenciales ni contraseñas."
    ],
    requiresHumanReview: false,
    version: "faq-of-verification-help-2026-07-07.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-07"
  }
];

export const frequentlyAskedQuestionEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
