import { KnowledgeEntrySchema, type KnowledgeEntryInput } from "@/domain/businessKnowledge";
import { followUpAttemptCountRange } from "@/domain/businessPolicy";

export const followUpPolicy = {
  intervalDaysMin: 1,
  intervalDaysMax: 2,
  attemptsMin: followUpAttemptCountRange().min,
  attemptsMax: followUpAttemptCountRange().max,
  recoveryAttemptsAfterDecline: 1,
  sendIndefinitely: false
} as const;

const entries: KnowledgeEntryInput[] = [
  {
    id: "follow-up-limited-attempts",
    category: "OBJECTION_HANDLING",
    title: "Seguimientos limitados",
    facts: [
      "Si deja de responder, se envia un seguimiento cada uno o dos dias.",
      "Se realizan entre dos y tres intentos.",
      "No se envian mensajes indefinidamente.",
      "Si dice que no le interesa, se intenta recuperar una sola vez y si mantiene rechazo se cierra."
    ],
    approvedAnswerPoints: ["Si no responde, se puede hacer seguimiento limitado, no insistir indefinidamente."],
    prohibitedClaims: [
      "Enviar mensajes indefinidos.",
      "Insistir despues de rechazo mantenido.",
      "Dar explicaciones fisicas de rechazo."
    ],
    allowedStates: ["NEW_LEAD", "QUALIFYING", "WAITING_HUMAN_REVIEW", "APPROVED", "COLLECTING_CALL_DETAILS"],
    tags: ["follow-up", "decline", "limited"],
    mandatoryNuances: ["Si no encaja, de momento puede dejar de responder sin motivos fisicos o detallados."],
    escalationConditions: ["Rechazo ambiguo.", "Enfado.", "Sospecha de estafa."],
    requiresHumanReview: false,
    version: "follow-up-limited-attempts-2026-06-09.1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-09"
  }
];

export const followUpPolicyEntries = entries.map((entry) => KnowledgeEntrySchema.parse(entry));
