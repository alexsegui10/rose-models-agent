import type { ConversationEngine } from "@/application/conversationEngine";
import type { Candidate } from "@/domain/candidate";
import { deliverProactiveMessage, type CandidateChannel } from "@/server/proactiveDelivery";

/** Lo que devuelven applyHumanDecision / applyDeviceQualityDecision (lo que necesita la entrega). */
interface DecisionResult {
  candidate: Candidate;
  proposedMessage?: string | null;
  reprocessTrailingInbound?: string[] | null;
}

export interface DecisionOutcome {
  candidate: Candidate;
  proposedMessage: string | null;
  sentToCandidate: { delivered: boolean; channel: CandidateChannel } | null;
}

/**
 * Resuelve el mensaje que recibe la candidata tras una decision del CRM que reanuda el bot (feature C):
 *
 * - Si escribio DURANTE la pausa (reprocessTrailingInbound) -> el bot RESPONDE a eso: reprocesa su ultimo
 *   bloque (handleIncomingTurn reprocessExisting, que NO re-guarda el inbound ni bumpea version) y entrega
 *   la respuesta contextual. Si ese reproceso re-escala (objecion/desconfianza -> HUMAN_INTERVENTION_REQUIRED),
 *   automationBlocked=true -> NO se entrega nada (queda en revision para Alex; estado ya persistido).
 * - Si NO escribio nada en la pausa -> se entrega el proactivo fijo ("Buenas noticias... ¿que dia te viene?").
 *
 * Salida unica: respuesta contextual O proactivo fijo, nunca ambos (el contrato de la decision ya fuerza
 * proposedMessage=null cuando hay reprocessTrailingInbound). El mensaje se guarda UNA vez (el motor) y se
 * envia UNA vez (deliverProactiveMessage no guarda). No-op de envio para candidatas del simulador.
 */
export async function deliverDecisionOutcome(
  engine: Pick<ConversationEngine, "handleIncomingTurn">,
  result: DecisionResult
): Promise<DecisionOutcome> {
  if (result.reprocessTrailingInbound && result.reprocessTrailingInbound.length > 0) {
    const reprocessed = await engine.handleIncomingTurn({
      instagramUsername: result.candidate.instagramUsername,
      messages: result.reprocessTrailingInbound.map((content) => ({ content })),
      reprocessExisting: true
    });
    const response = reprocessed.response.trim();
    // Entregar la respuesta del reproceso SOLO si el motor la marca SENT (mismo contrato que webhook/flush:
    // la respuesta del bot es CONTENIDO del modelo, no el proactivo fijo determinista). En HUMAN_APPROVAL el
    // motor la deja PENDING_APPROVAL -> NO se auto-envia, queda en la cola de Alex (igual que cualquier otra
    // respuesta del bot en ese modo). En re-escalado (objecion -> HIR) es BLOCKED -> tampoco se envia. Asi el
    // reanudar NO se salta la aprobacion humana (invariantes 1 y 4). proposedMessage se devuelve igual (texto
    // propuesto), pero sentToCandidate=null deja claro que NO se envio.
    const sentToCandidate =
      reprocessed.deliveryStatus === "SENT" && !reprocessed.automationBlocked && response.length > 0
        ? await deliverProactiveMessage(reprocessed.candidate, response)
        : null;
    return {
      candidate: reprocessed.candidate,
      proposedMessage: response.length > 0 ? reprocessed.response : null,
      sentToCandidate
    };
  }

  const proposedMessage = result.proposedMessage ?? null;
  const sentToCandidate = proposedMessage ? await deliverProactiveMessage(result.candidate, proposedMessage) : null;
  return { candidate: result.candidate, proposedMessage, sentToCandidate };
}
