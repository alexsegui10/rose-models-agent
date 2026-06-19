import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import type { ImportedConversation } from "../../application/conversationImport";
import type { NegotiationDecision } from "../../domain/businessKnowledge";
import {
  CandidateCommercialTierSchema,
  CandidateStateSchema,
  ConversationAuthorSchema,
  ConversationRoleSchema,
  DeviceEligibilitySchema,
  DeviceTypeSchema,
  HumanFitDecisionSchema,
  HumanProfileReviewStatusSchema,
  HumanReviewReasonSchema,
  HumanReviewStatusSchema,
  InterestLevelSchema,
  ProfileVisibilitySchema,
  type CallRecord,
  type OnboardingBlocker
} from "../../domain/candidate";
import {
  ABWinnerSchema,
  type ABModelRun,
  type EvaluationSessionSummary,
  type EvaluationTurnFeedback,
  type PlaybackTurn
} from "../../domain/evaluation";
import { ConversationFeedbackStatusSchema, type AlexStyleRating } from "../../domain/styleEvaluation";

/**
 * Schema Drizzle (PostgreSQL). DEBE mantenerse en sincronía con los schemas Zod de `src/domain/`
 * (regla de `.claude/rules/infrastructure.md`): si cambias uno, revisa el otro en el mismo cambio.
 *
 * Decisiones de diseño:
 *
 * 1. Enums de dominio como `text` (NO `pgEnum`), con narrowing en compilación derivado de las
 *    `.options` del Zod del dominio y validación Zod en el límite (los repositorios parsean al
 *    leer/escribir). Por qué: los pg enums hacen dolorosas las migraciones (`ALTER TYPE` no puede
 *    eliminar ni reordenar valores y añadirlos tiene restricciones transaccionales); con `text`,
 *    añadir un valor al dominio NO requiere migración y la única fuente de verdad sigue siendo el
 *    Zod de `src/domain/`. Al derivar el narrowing de `Schema.options`, una divergencia
 *    Zod<->Drizzle rompe el typecheck. Los pocos enums sin schema Zod exportado (decisión de
 *    negociación, status/purpose de importaciones) se declaran inline con `satisfies` contra el
 *    tipo del dominio para conservar esa misma garantía.
 *
 * 2. `jsonb` para estructuras anidadas que la aplicación lee y escribe como documento completo
 *    (runs A/B, turnos de playback, summaries, mensajes importados): son payloads de
 *    visualización/auditoría, nunca se filtran columna a columna en SQL, y Zod los valida al
 *    rehidratarlos. Normalizarlos en tablas hijas añadiría joins sin ninguna consulta que lo pida.
 *
 * 3. `ON DELETE CASCADE` en todas las FK que cuelgan de `candidates` (y de feedback/importaciones):
 *    el procedimiento de borrado DSAR (Fase L del roadmap) debe poder eliminar a una candidata con
 *    un solo DELETE sin dejar mensajes/transiciones/feedback huérfanos.
 *
 * 4. El invariante de dedupe de mensajes vive en la base de datos: índice UNIQUE parcial sobre
 *    (candidate_id, external_message_id) WHERE external_message_id IS NOT NULL.
 */

// Mantener en sincronía con el z.enum inline de NegotiationDecisionSchema (domain/businessKnowledge.ts);
// `satisfies` garantiza que cada valor existe en el tipo del dominio.
const negotiationDecisionValues = [
  "KEEP_STANDARD_TERMS",
  "ALLOW_CUSTOM_TERMS",
  "REJECT_NEGOTIATION",
  "DISCUSS_IN_CALL"
] as const satisfies readonly NegotiationDecision["decision"][];

type ImportedConversationStatus = ImportedConversation["status"];
type ImportedConversationPurpose = ImportedConversation["purpose"];
type ImportedConversationMessage = ImportedConversation["messages"][number];

// Mantener en sincronía con ImportedConversationStatusSchema / purpose (application/conversationImport.ts).
const importedConversationStatusValues = [
  "RAW_REAL",
  "CORRECTED",
  "ALEX_APPROVED"
] as const satisfies readonly ImportedConversationStatus[];
const importedConversationPurposeValues = ["EXAMPLE", "EVALUATION"] as const satisfies readonly ImportedConversationPurpose[];

export const candidates = pgTable("candidates", {
  id: uuid("id").primaryKey().defaultRandom(),
  instagramUsername: text("instagram_username").notNull().unique(),
  displayName: text("display_name"),
  firstName: text("first_name"),
  age: integer("age"),
  isAdultConfirmed: boolean("is_adult_confirmed").notNull().default(false),
  country: text("country"),
  city: text("city"),
  phone: text("phone"),
  deviceType: text("device_type", { enum: DeviceTypeSchema.options }).notNull().default("UNKNOWN"),
  deviceModel: text("device_model"),
  deviceEligibility: text("device_eligibility", { enum: DeviceEligibilitySchema.options }).notNull().default("UNKNOWN"),
  commercialTier: text("commercial_tier", { enum: CandidateCommercialTierSchema.options }).notNull().default("STANDARD"),
  declaredProfileVisibility: text("declared_profile_visibility", { enum: ProfileVisibilitySchema.options })
    .notNull()
    .default("UNKNOWN"),
  candidateClaimsFollowRequestAccepted: boolean("candidate_claims_follow_request_accepted").notNull().default(false),
  humanVerifiedProfileAccess: boolean("human_verified_profile_access").notNull().default(false),
  humanProfileReviewStatus: text("human_profile_review_status", { enum: HumanProfileReviewStatusSchema.options })
    .notNull()
    .default("NOT_REVIEWED"),
  humanFitDecision: text("human_fit_decision", { enum: HumanFitDecisionSchema.options }).notNull().default("PENDING"),
  hasOnlyFans: boolean("has_only_fans"),
  worksWithAnotherAgency: boolean("works_with_another_agency"),
  experienceDescription: text("experience_description"),
  // double precision (no integer): el Zod del dominio es z.number().nonnegative(), admite decimales.
  currentMonthlyRevenue: doublePrecision("current_monthly_revenue"),
  contentAvailability: text("content_availability"),
  goals: text("goals"),
  interestLevel: text("interest_level", { enum: InterestLevelSchema.options }).notNull().default("UNKNOWN"),
  scheduledCallSlot: text("scheduled_call_slot"),
  // Instante de inicio de la llamada agendada en ms UTC. bigint (mode number): cabe en Number con holgura
  // (ms hasta el ano ~275760) y el dominio lo trata como z.number().int().optional().
  scheduledCallStartMs: bigint("scheduled_call_start_ms", { mode: "number" }),
  // Intentos de llamada disparados (incrementa noteCallAttempt al iniciar la llamada, no al recibir el
  // resultado): gobierna el reintento diferido.
  callAttempts: integer("call_attempts").notNull().default(0),
  // Resultado de la ultima llamada (documento completo: duracion, % negociado, resumen, transcripcion).
  lastCall: jsonb("last_call").$type<CallRecord>(),
  objections: jsonb("objections").$type<string[]>().notNull().default([]),
  faceObjectionCount: integer("face_objection_count").notNull().default(0),
  notes: jsonb("notes").$type<string[]>().notNull().default([]),
  conversationSummary: text("conversation_summary").notNull().default(""),
  currentState: text("current_state", { enum: CandidateStateSchema.options }).notNull().default("NEW_LEAD"),
  humanReviewStatus: text("human_review_status", { enum: HumanReviewStatusSchema.options }).notNull().default("NOT_REQUIRED"),
  humanReviewReason: text("human_review_reason", { enum: HumanReviewReasonSchema.options }),
  onboardingBlockers: jsonb("onboarding_blockers").$type<OnboardingBlocker[]>().notNull().default([]),
  automationPaused: boolean("automation_paused").notNull().default(false),
  manualControlActive: boolean("manual_control_active").notNull().default(false),
  generationCancellationVersion: integer("generation_cancellation_version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true })
});

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    role: text("role", { enum: ConversationRoleSchema.options }).notNull(),
    author: text("author", { enum: ConversationAuthorSchema.options }).notNull(),
    content: text("content").notNull(),
    externalMessageId: text("external_message_id"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index("conversation_messages_candidate_id_idx").on(table.candidateId),
    // Invariante de dedupe en la BD: un mismo mensaje externo (Instagram) no puede insertarse dos
    // veces para la misma candidata. Parcial porque los mensajes generados localmente no traen
    // external_message_id y no deben chocar entre sí.
    uniqueIndex("conversation_messages_candidate_external_message_id_unique")
      .on(table.candidateId, table.externalMessageId)
      .where(sql`${table.externalMessageId} is not null`)
  ]
);

export const stateTransitions = pgTable(
  "state_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    fromState: text("from_state", { enum: CandidateStateSchema.options }).notNull(),
    toState: text("to_state", { enum: CandidateStateSchema.options }).notNull(),
    trigger: text("trigger").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("state_transitions_candidate_id_idx").on(table.candidateId)]
);

export const negotiationDecisions = pgTable("negotiation_decisions", {
  candidateId: uuid("candidate_id")
    .primaryKey()
    .references(() => candidates.id, { onDelete: "cascade" }),
  // double precision (no numeric en modo string): el dominio trabaja con z.number() 0-100.
  requestedModelPercentage: doublePrecision("requested_model_percentage"),
  currentPolicyAgencyPercentage: doublePrecision("current_policy_agency_percentage"),
  currentPolicyModelPercentage: doublePrecision("current_policy_model_percentage"),
  decision: text("decision", { enum: negotiationDecisionValues }).notNull(),
  approvedAgencyPercentage: doublePrecision("approved_agency_percentage"),
  approvedModelPercentage: doublePrecision("approved_model_percentage"),
  reason: text("reason").notNull(),
  decidedBy: text("decided_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull()
});

export const conversationFeedback = pgTable(
  "conversation_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    // Sin FK: el feedback puede referirse a un borrador generado que nunca llegó a persistirse
    // como conversation_message (modo DRAFT_ONLY / respuestas rechazadas antes de enviar).
    messageId: uuid("message_id"),
    status: text("status", { enum: ConversationFeedbackStatusSchema.options }).notNull(),
    originalResponse: text("original_response").notNull(),
    editedResponse: text("edited_response"),
    reason: text("reason"),
    styleRating: integer("style_rating").$type<AlexStyleRating>(),
    state: text("state", { enum: CandidateStateSchema.options }).notNull(),
    contextSnapshot: text("context_snapshot").notNull(),
    styleProfileVersion: text("style_profile_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelVersion: text("model_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("conversation_feedback_candidate_id_idx").on(table.candidateId)]
);

export const approvedResponses = pgTable(
  "approved_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => conversationFeedback.id, { onDelete: "cascade" }),
    response: text("response").notNull(),
    state: text("state", { enum: CandidateStateSchema.options }).notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    styleProfileVersion: text("style_profile_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    modelVersion: text("model_version").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index("approved_responses_feedback_id_idx").on(table.feedbackId)]
);

export const abEvaluationCases = pgTable("ab_evaluation_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  blind: boolean("blind").notNull().default(true),
  initialState: text("initial_state", { enum: CandidateStateSchema.options }).notNull().default("NEW_LEAD"),
  profileVisibility: text("profile_visibility", { enum: ProfileVisibilitySchema.options }).notNull().default("PUBLIC"),
  messages: jsonb("messages").$type<string[]>().notNull(),
  modelA: text("model_a").notNull(),
  modelB: text("model_b").notNull(),
  // Runs completos (respuesta, traza de proveedor, ids de conocimiento/ejemplos, score) como
  // documento: se muestran y auditan enteros, nunca se consultan por subcampo.
  runA: jsonb("run_a").$type<ABModelRun>().notNull(),
  runB: jsonb("run_b").$type<ABModelRun>().notNull(),
  winner: text("winner", { enum: ABWinnerSchema.options }),
  styleRating: integer("style_rating").$type<AlexStyleRating>(),
  note: text("note")
});

export const importedConversations = pgTable("imported_conversations", {
  // id textual definido por el fichero de importación (z.string().min(1)), no uuid.
  id: text("id").primaryKey(),
  status: text("status", { enum: importedConversationStatusValues }).notNull(),
  source: text("source").$type<ImportedConversation["source"]>().notNull().default("ANONYMIZED_JSON"),
  purpose: text("purpose", { enum: importedConversationPurposeValues }).notNull(),
  category: text("category").notNull().default("uncategorized"),
  initialState: text("initial_state", { enum: CandidateStateSchema.options }).notNull().default("NEW_LEAD"),
  stateBefore: text("state_before", { enum: CandidateStateSchema.options }).notNull().default("NEW_LEAD"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  // Los mensajes importados son el documento de trabajo de la evaluación: se reproducen y editan
  // como unidad y Zod (ImportedConversationSchema) los valida al rehidratar.
  messages: jsonb("messages").$type<ImportedConversationMessage[]>().notNull(),
  originalAlexResponses: jsonb("original_alex_responses").$type<string[]>().notNull().default([]),
  correctedResponses: jsonb("corrected_responses").$type<string[]>().notNull().default([]),
  approved: boolean("approved").notNull().default(false),
  idealNextResponse: text("ideal_next_response"),
  notes: text("notes"),
  outcome: text("outcome"),
  endedInCall: boolean("ended_in_call"),
  candidateApproved: boolean("candidate_approved"),
  anonymizedPersonalData: jsonb("anonymized_personal_data").$type<Record<string, string>>().notNull().default({})
});

export const evaluationSessions = pgTable(
  "evaluation_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // La FK se declara abajo con foreignKey() para darle un nombre explícito corto: el que
    // autogenera Drizzle supera los 63 caracteres y Postgres lo truncaría con un NOTICE.
    conversationId: text("conversation_id").notNull(),
    model: text("model").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // turn_feedback / playback_turns / summary son payloads de visualización y auditoría de la UI
    // de evaluación: se leen y reescriben como documento completo en cada feedback de turno y no
    // existe ninguna consulta relacional sobre sus subcampos, así que jsonb es lo correcto
    // (normalizarlos costaría 3 tablas y joins sin beneficio de consulta).
    turnFeedback: jsonb("turn_feedback").$type<EvaluationTurnFeedback[]>().notNull().default([]),
    playbackTurns: jsonb("playback_turns").$type<PlaybackTurn[]>(),
    summary: jsonb("summary").$type<EvaluationSessionSummary>()
  },
  (table) => [
    index("evaluation_sessions_conversation_id_idx").on(table.conversationId),
    foreignKey({
      columns: [table.conversationId],
      foreignColumns: [importedConversations.id],
      name: "evaluation_sessions_conversation_id_fk"
    }).onDelete("cascade")
  ]
);
