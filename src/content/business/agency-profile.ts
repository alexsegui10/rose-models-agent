import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";

const entries: KnowledgeEntryInput[] = [
  {
    id: "agency-profile-rose-models",
    category: "AGENCY_PROFILE",
    title: "Rose Models como agencia espanola (100% online)",
    facts: [
      "Rose Models es una agencia espanola representada en el chat por Alex.",
      // Decision de Alex (10-jul, sweep R9): "¿oficina fisica o todo online?" se responde al momento.
      "Se trabaja 100% online: no hace falta desplazarse ni acudir a ninguna oficina."
    ],
    approvedAnswerPoints: [
      "Soy Alex, de Rose Models.",
      "Somos una agencia espanola.",
      "Trabajamos todo online, asi que da igual donde estes: no tienes que desplazarte a ninguna oficina."
    ],
    prohibitedClaims: [
      "Decir que es una gran empresa internacional si no esta confirmado.",
      "Inventar sedes, clientes o casos de exito."
    ],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["agency", "identity", "rose-models"],
    requiresHumanReview: false,
    version: "agency-profile-2026-07-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-10"
  },
  {
    // Decision de Alex (10-jul, sweep R9): "¿oficina fisica o todo online?" tiene entrada PROPIA para que
    // la respuesta lidere con lo del online (en el perfil general quedaba enterrada tras "Soy Alex...").
    id: "agency-online-no-office",
    category: "AGENCY_PROFILE",
    title: "Se trabaja 100% online (sin oficina fisica)",
    facts: [
      "Se trabaja 100% online: no hace falta desplazarse ni acudir a ninguna oficina.",
      "Da igual donde este la candidata: todo el proceso y el trabajo son a distancia."
    ],
    approvedAnswerPoints: [
      "Trabajamos todo online, asi que da igual donde estes: no tienes que desplazarte a ninguna oficina.",
      "Todo el proceso es a distancia, comodo para ti."
    ],
    prohibitedClaims: ["Inventar sedes u oficinas.", "Pedir reuniones presenciales."],
    allowedStates: ["NEW_LEAD", "WAITING_PROFILE_ACCESS", "QUALIFYING", "APPROVED", "HUMAN_INTERVENTION_REQUIRED"],
    tags: ["location", "online", "remote", "agency"],
    requiresHumanReview: false,
    version: "agency-online-no-office-2026-07-10.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-07-10"
  }
];

export const agencyProfileEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
