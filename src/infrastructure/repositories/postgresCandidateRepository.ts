import { and, asc, desc, eq, sql } from "drizzle-orm";
import { NegotiationDecisionSchema, type NegotiationDecision } from "@/domain/businessKnowledge";
import { normalizeCandidate, type Candidate, type ConversationMessage, type StateTransition } from "@/domain/candidate";
import type { Database } from "../db/client";
import { candidates, conversationMessages, negotiationDecisions, stateTransitions } from "../db/schema";
import { isUuid, warnInvalidRow } from "./postgresUtils";
import type { CandidateRepository } from "./types";

type CandidateRow = typeof candidates.$inferSelect;
type CandidateInsert = typeof candidates.$inferInsert;
type MessageRow = typeof conversationMessages.$inferSelect;
type TransitionRow = typeof stateTransitions.$inferSelect;
type NegotiationDecisionRow = typeof negotiationDecisions.$inferSelect;
type NegotiationDecisionInsert = typeof negotiationDecisions.$inferInsert;

export class PostgresCandidateRepository implements CandidateRepository {
  constructor(private readonly db: Database) {}

  async findCandidateById(id: string): Promise<Candidate | null> {
    if (!isUuid(id)) {
      return null;
    }

    const rows = await this.db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
    return rows[0] ? rowToCandidate(rows[0]) : null;
  }

  async findCandidateByInstagram(instagramUsername: string): Promise<Candidate | null> {
    const rows = await this.db
      .select()
      .from(candidates)
      .where(sql`lower(${candidates.instagramUsername}) = lower(${instagramUsername})`)
      .limit(1);
    return rows[0] ? rowToCandidate(rows[0]) : null;
  }

  async listCandidates(): Promise<Candidate[]> {
    const rows = await this.db.select().from(candidates).orderBy(desc(candidates.updatedAt));
    return rows.map(rowToCandidate);
  }

  async saveCandidate(candidate: Candidate): Promise<Candidate> {
    // Misma semántica que InMemoryCandidateRepository.normalizeAndStore: normalizar ANTES de
    // escribir para que lo persistido y lo devuelto coincidan.
    const normalized = normalizeCandidate(candidate);
    const row = candidateToRow(normalized);
    await this.db.insert(candidates).values(row).onConflictDoUpdate({ target: candidates.id, set: row });
    return normalized;
  }

  async deleteCandidate(id: string): Promise<void> {
    if (!isUuid(id)) {
      return;
    }
    // La FK con ON DELETE CASCADE borra mensajes/transiciones/decisiones de la candidata.
    await this.db.delete(candidates).where(eq(candidates.id, id));
  }

  async listMessages(candidateId: string, limit = 50): Promise<ConversationMessage[]> {
    if (!isUuid(candidateId)) {
      return [];
    }

    // Los últimos `limit` mensajes en orden cronológico (paridad con el slice(-limit) de InMemory).
    // El id como desempate da orden estable cuando dos mensajes comparten milisegundo
    // (habitual con el proveedor determinista, que persiste entrada y salida casi a la vez).
    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(eq(conversationMessages.candidateId, candidateId))
      .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
      .limit(limit);
    return rows.reverse().map(rowToMessage);
  }

  async findMessageByExternalId(candidateId: string, externalMessageId: string): Promise<ConversationMessage | null> {
    if (!isUuid(candidateId)) {
      return null;
    }

    const rows = await this.db
      .select()
      .from(conversationMessages)
      .where(
        and(eq(conversationMessages.candidateId, candidateId), eq(conversationMessages.externalMessageId, externalMessageId))
      )
      .limit(1);
    return rows[0] ? rowToMessage(rows[0]) : null;
  }

  async addMessage(message: ConversationMessage): Promise<void> {
    // Paridad con InMemory: una respuesta del agente generada para los mismos mensajes entrantes
    // (mismo contenido + mismos inboundExternalMessageIds) no se inserta dos veces.
    const inboundExternalMessageIds = message.metadata?.inboundExternalMessageIds;
    if (message.role === "agent" && typeof inboundExternalMessageIds === "string") {
      const duplicateOutbound = await this.db
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.candidateId, message.candidateId),
            eq(conversationMessages.role, "agent"),
            eq(conversationMessages.content, message.content),
            sql`${conversationMessages.metadata} ->> 'inboundExternalMessageIds' = ${inboundExternalMessageIds}`
          )
        )
        .limit(1);
      if (duplicateOutbound.length > 0) {
        return;
      }
    }

    // El dedupe por (candidate_id, external_message_id) lo garantiza el índice único parcial de la
    // BD: onConflictDoNothing en lugar de leer-y-escribir, así es atómico frente a concurrencia.
    await this.db
      .insert(conversationMessages)
      .values({
        id: message.id,
        candidateId: message.candidateId,
        role: message.role,
        author: message.author,
        content: message.content,
        externalMessageId: message.externalMessageId ?? null,
        metadata: message.metadata ?? null,
        createdAt: message.createdAt
      })
      .onConflictDoNothing();
  }

  async listTransitions(candidateId: string): Promise<StateTransition[]> {
    if (!isUuid(candidateId)) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(stateTransitions)
      .where(eq(stateTransitions.candidateId, candidateId))
      .orderBy(asc(stateTransitions.createdAt));
    return rows.map(rowToTransition);
  }

  async addTransition(transition: StateTransition): Promise<void> {
    // Paridad con InMemory: una transición idéntica (mismo from/to/trigger/reason) no se duplica
    // aunque el motor la vuelva a aplicar en un reintento.
    const duplicate = await this.db
      .select({ id: stateTransitions.id })
      .from(stateTransitions)
      .where(
        and(
          eq(stateTransitions.candidateId, transition.candidateId),
          eq(stateTransitions.fromState, transition.fromState),
          eq(stateTransitions.toState, transition.toState),
          eq(stateTransitions.trigger, transition.trigger),
          eq(stateTransitions.reason, transition.reason)
        )
      )
      .limit(1);
    if (duplicate.length > 0) {
      return;
    }

    await this.db.insert(stateTransitions).values({
      id: transition.id,
      candidateId: transition.candidateId,
      fromState: transition.fromState,
      toState: transition.toState,
      trigger: transition.trigger,
      reason: transition.reason,
      createdAt: transition.createdAt
    });
  }

  async findApprovedNegotiationDecision(candidateId: string): Promise<NegotiationDecision | null> {
    if (!isUuid(candidateId)) {
      return null;
    }

    const rows = await this.db
      .select()
      .from(negotiationDecisions)
      .where(eq(negotiationDecisions.candidateId, candidateId))
      .limit(1);
    const decision = rows[0] ? rowToNegotiationDecision(rows[0]) : null;
    return decision?.decision === "ALLOW_CUSTOM_TERMS" ? decision : null;
  }

  async saveNegotiationDecision(decision: NegotiationDecision): Promise<NegotiationDecision> {
    // Validación Zod en el límite antes de escribir (los porcentajes deben sumar 100, etc.).
    const parsed = NegotiationDecisionSchema.parse(decision);
    const row: NegotiationDecisionInsert = {
      candidateId: parsed.candidateId,
      requestedModelPercentage: parsed.requestedModelPercentage,
      currentPolicyAgencyPercentage: parsed.currentPolicyAgencyPercentage,
      currentPolicyModelPercentage: parsed.currentPolicyModelPercentage,
      decision: parsed.decision,
      approvedAgencyPercentage: parsed.approvedAgencyPercentage,
      approvedModelPercentage: parsed.approvedModelPercentage,
      reason: parsed.reason,
      decidedBy: parsed.decidedBy,
      decidedAt: parsed.decidedAt
    };
    await this.db
      .insert(negotiationDecisions)
      .values(row)
      .onConflictDoUpdate({ target: negotiationDecisions.candidateId, set: row });
    return parsed;
  }
}

/**
 * Normalización-al-leer con `normalizeCandidate`: stopgap CONSCIENTE y documentado (regla
 * `.claude/rules/infrastructure.md`). Las filas de Postgres ya nacen normalizadas por el schema,
 * pero se mantiene la misma puerta de entrada que en InMemory para que datos migrados desde el
 * snapshot JSON (campos legacy) y cualquier divergencia futura pasen SIEMPRE por el Zod del
 * dominio. A medio plazo esta lógica debe migrar a migraciones/schema, no duplicarse más.
 */
function rowToCandidate(row: CandidateRow): Candidate {
  return normalizeCandidate({
    id: row.id,
    instagramUsername: row.instagramUsername,
    displayName: row.displayName ?? undefined,
    firstName: row.firstName ?? undefined,
    age: row.age ?? undefined,
    isAdultConfirmed: row.isAdultConfirmed,
    country: row.country ?? undefined,
    city: row.city ?? undefined,
    phone: row.phone ?? undefined,
    deviceType: row.deviceType,
    deviceModel: row.deviceModel,
    deviceEligibility: row.deviceEligibility,
    commercialTier: row.commercialTier,
    declaredProfileVisibility: row.declaredProfileVisibility,
    candidateClaimsFollowRequestAccepted: row.candidateClaimsFollowRequestAccepted,
    humanVerifiedProfileAccess: row.humanVerifiedProfileAccess,
    humanProfileReviewStatus: row.humanProfileReviewStatus,
    humanFitDecision: row.humanFitDecision,
    hasOnlyFans: row.hasOnlyFans ?? undefined,
    worksWithAnotherAgency: row.worksWithAnotherAgency ?? undefined,
    experienceDescription: row.experienceDescription ?? undefined,
    currentMonthlyRevenue: row.currentMonthlyRevenue ?? undefined,
    contentAvailability: row.contentAvailability ?? undefined,
    goals: row.goals ?? undefined,
    interestLevel: row.interestLevel,
    objections: row.objections,
    scheduledCallSlot: row.scheduledCallSlot ?? undefined,
    faceObjectionCount: row.faceObjectionCount,
    notes: row.notes,
    conversationSummary: row.conversationSummary,
    currentState: row.currentState,
    humanReviewStatus: row.humanReviewStatus,
    humanReviewReason: row.humanReviewReason ?? undefined,
    onboardingBlockers: row.onboardingBlockers,
    automationPaused: row.automationPaused,
    manualControlActive: row.manualControlActive,
    generationCancellationVersion: row.generationCancellationVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastMessageAt: row.lastMessageAt ?? undefined
  });
}

function candidateToRow(candidate: Candidate): CandidateInsert {
  return {
    id: candidate.id,
    instagramUsername: candidate.instagramUsername,
    displayName: candidate.displayName ?? null,
    firstName: candidate.firstName ?? null,
    age: candidate.age ?? null,
    isAdultConfirmed: candidate.isAdultConfirmed,
    country: candidate.country ?? null,
    city: candidate.city ?? null,
    phone: candidate.phone ?? null,
    deviceType: candidate.deviceType,
    deviceModel: candidate.deviceModel,
    deviceEligibility: candidate.deviceEligibility,
    commercialTier: candidate.commercialTier,
    declaredProfileVisibility: candidate.declaredProfileVisibility,
    candidateClaimsFollowRequestAccepted: candidate.candidateClaimsFollowRequestAccepted,
    humanVerifiedProfileAccess: candidate.humanVerifiedProfileAccess,
    humanProfileReviewStatus: candidate.humanProfileReviewStatus,
    humanFitDecision: candidate.humanFitDecision,
    hasOnlyFans: candidate.hasOnlyFans ?? null,
    worksWithAnotherAgency: candidate.worksWithAnotherAgency ?? null,
    experienceDescription: candidate.experienceDescription ?? null,
    currentMonthlyRevenue: candidate.currentMonthlyRevenue ?? null,
    contentAvailability: candidate.contentAvailability ?? null,
    goals: candidate.goals ?? null,
    interestLevel: candidate.interestLevel,
    scheduledCallSlot: candidate.scheduledCallSlot ?? null,
    objections: candidate.objections,
    faceObjectionCount: candidate.faceObjectionCount,
    notes: candidate.notes,
    conversationSummary: candidate.conversationSummary,
    currentState: candidate.currentState,
    humanReviewStatus: candidate.humanReviewStatus,
    humanReviewReason: candidate.humanReviewReason ?? null,
    onboardingBlockers: candidate.onboardingBlockers,
    automationPaused: candidate.automationPaused,
    manualControlActive: candidate.manualControlActive,
    generationCancellationVersion: candidate.generationCancellationVersion,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    lastMessageAt: candidate.lastMessageAt ?? null
  };
}

function rowToMessage(row: MessageRow): ConversationMessage {
  return {
    id: row.id,
    candidateId: row.candidateId,
    role: row.role,
    author: row.author,
    content: row.content,
    externalMessageId: row.externalMessageId ?? undefined,
    createdAt: row.createdAt,
    metadata: row.metadata ?? undefined
  };
}

function rowToTransition(row: TransitionRow): StateTransition {
  return {
    id: row.id,
    candidateId: row.candidateId,
    fromState: row.fromState,
    toState: row.toState,
    trigger: row.trigger,
    reason: row.reason,
    createdAt: row.createdAt
  };
}

function rowToNegotiationDecision(row: NegotiationDecisionRow): NegotiationDecision | null {
  const parsed = NegotiationDecisionSchema.safeParse({
    candidateId: row.candidateId,
    requestedModelPercentage: row.requestedModelPercentage,
    currentPolicyAgencyPercentage: row.currentPolicyAgencyPercentage,
    currentPolicyModelPercentage: row.currentPolicyModelPercentage,
    decision: row.decision,
    approvedAgencyPercentage: row.approvedAgencyPercentage,
    approvedModelPercentage: row.approvedModelPercentage,
    reason: row.reason,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt
  });
  if (!parsed.success) {
    warnInvalidRow("negotiation_decisions", row.candidateId, parsed.error);
    return null;
  }
  return parsed.data;
}
