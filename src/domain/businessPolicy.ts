import { CommunicationPolicySchema, ContentProductionPolicySchema } from "./businessKnowledge";

// Politicas de negocio PURAS (sin I/O, parseadas con Zod en carga). Viven en `domain` para que el
// contenido (`src/content`) las consuma sin importar de `application` — antes esto creaba un ciclo de
// dependencia application<->content. `application/policyRules` las re-exporta por compatibilidad.

export const communicationPolicy = CommunicationPolicySchema.parse({
  expectedResponseTimeHours: 48,
  singleDelayCausesRejection: false,
  repeatedDelaysRequireHumanReview: true
});

export const contentProductionPolicy = ContentProductionPolicySchema.parse({
  warmupDays: 5,
  warmupPhotosPerDayMin: 2,
  warmupPhotosPerDayMax: 3,
  targetReelsPerWeekMin: 10,
  targetReelsPerWeekMax: 20,
  isContractualMinimumConfirmed: false
});

export function followUpAttemptCountRange(): { min: 2; max: 3 } {
  return { min: 2, max: 3 };
}
