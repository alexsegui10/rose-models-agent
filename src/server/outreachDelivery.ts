import crypto from "node:crypto";
import { planOutreach, REENGAGE_TRIGGER, RESCHEDULE_TRIGGER } from "@/application/outreachPlanner";
import { createTransition } from "@/domain/stateMachine";
import type { Candidate, ConversationMessage } from "@/domain/candidate";
import type { CandidateRepository } from "@/infrastructure/repositories/types";

/**
 * Envio + persistencia del RE-ENGANCHE / REAGENDADO para UNA candidata. Extraido del loop del cron
 * (/api/cron/outreach) para poder reusarlo tal cual desde el reagendado INSTANTANEO (/api/call/reschedule-now):
 * mismo comportamiento, cero duplicacion. La DECISION (que escribir, si escribir) sigue siendo pura y vive en
 * `planOutreach`; aqui solo se orquesta el efecto (enviar por IG + persistir mensaje/estado), como manda la
 * separacion decision-pura / efecto-en-la-ruta.
 *
 * NO decide negocio ni toca invariantes: solo ejecuta lo que `planOutreach` ya decidio de forma determinista.
 */

/**
 * Contrato estructural minimo del proveedor de mensajeria de Instagram que necesita este modulo. Lo cumple
 * `GraphApiInstagramMessagingProvider` (que implementa `InstagramMessagingProvider`). Se tipa aqui de forma
 * estructural para no acoplar el server a la clase concreta.
 */
export interface OutreachMessagingProvider {
  sendTextMessage(recipientId: string, message: string, options?: { humanAgentTag?: boolean }): Promise<boolean>;
}

export type OutreachDeliveryResult = "skipped" | "reengaged" | "rescheduled" | "cooled" | "failed";

/**
 * Procesa el outreach de UNA candidata igual que hace el loop del cron por iteracion:
 *  - planOutreach -> si null: "skipped" (no aplicaba, ya reagendada, pausada, fuera de ventana, etc.).
 *  - envia el mensaje por IG; si el provider no lo acepta: "failed" (no persiste nada).
 *  - persiste el mensaje de agente con traza HONESTA (provider: "deterministic") y aplica el efecto de estado.
 *  - devuelve "rescheduled" | "cooled" | "reengaged" segun el tipo de plan.
 */
export async function processOutreachForCandidate(args: {
  repository: CandidateRepository;
  provider: OutreachMessagingProvider;
  candidate: Candidate;
  recentMessages: ConversationMessage[];
  now: Date;
}): Promise<OutreachDeliveryResult> {
  const { repository, provider, candidate, recentMessages, now } = args;

  const plan = planOutreach({ candidate, recentMessages, now });
  if (!plan) return "skipped";

  const trigger = plan.kind === "reschedule" ? RESCHEDULE_TRIGGER : REENGAGE_TRIGGER;
  const sent = await provider.sendTextMessage(candidate.instagramUsername, plan.message, {
    humanAgentTag: plan.humanAgentTag
  });
  if (!sent) return "failed";

  // Mensaje de agente con traza HONESTA: lo redacto codigo determinista, no la IA (invariante 6).
  await repository.addMessage({
    id: crypto.randomUUID(),
    candidateId: candidate.id,
    role: "agent",
    author: "AI_AGENT",
    content: plan.message,
    createdAt: new Date(),
    metadata: { provider: "deterministic", trigger, proactive: true, humanAgentTag: plan.humanAgentTag }
  });

  await applyOutcome(repository, candidate, plan, now);

  if (plan.kind === "reschedule") return "rescheduled";
  if (plan.markCold) return "cooled";
  return "reengaged";
}

/**
 * Aplica el efecto de estado del plan: reschedule -> transicion a COLLECTING_CALL_DETAILS; markCold -> deja una
 * NOTA COLD_NO_RESPONSE SIN cambiar a estado terminal (no se cierra a malas). El toque 1 de re-enganche no
 * cambia estado (solo se envia el mensaje, ya persistido arriba).
 */
async function applyOutcome(
  repository: CandidateRepository,
  candidate: Candidate,
  plan: NonNullable<ReturnType<typeof planOutreach>>,
  now: Date
): Promise<void> {
  if (plan.transitionTo && plan.transitionTo !== candidate.currentState) {
    const transition = createTransition({
      candidate,
      toState: plan.transitionTo,
      trigger: RESCHEDULE_TRIGGER,
      reason: "Re-enganche: reabrir el agendado tras 3 llamadas sin respuesta."
    });
    await repository.saveCandidate({ ...candidate, currentState: plan.transitionTo, updatedAt: now });
    await repository.addTransition(transition);
    return;
  }

  if (plan.markCold) {
    // Frio: NO cerrar. Solo dejar constancia para que Alex lo vea en el CRM.
    const note = `COLD_NO_RESPONSE: sin respuesta tras 2 toques de re-enganche (${now.toISOString()}).`;
    await repository.saveCandidate({ ...candidate, notes: [...candidate.notes, note], updatedAt: now });
  }
}
