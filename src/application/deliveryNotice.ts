/**
 * Clasificacion HONESTA de si un mensaje del bot generado por una decision del CRM (aprobar, avanzar etapa,
 * reanudar) llego DE VERDAD a la candidata. Existe porque el CRM mostraba "El bot le escribio" cuando el envio
 * a Meta habia fallado: la API devuelve `sentToCandidate` como OBJETO `{ delivered, channel }` (ver
 * DecisionOutcome en server/resumeReprocess.ts) y la UI lo evaluaba como booleano (`sentToCandidate && ...`),
 * de modo que `{ delivered: false }` contaba como exito por ser un objeto truthy.
 *
 * Puro y sin I/O: unico sitio donde vive la regla, con tests. La UI mapea el veredicto a su texto.
 */

export type DeliveryChannel = "instagram" | "whatsapp" | "none";

/** Forma EXACTA que devuelve la API en `sentToCandidate` (contrato con DecisionOutcome). */
export interface SentToCandidate {
  delivered: boolean;
  channel: DeliveryChannel;
}

export type DeliveryVerdict =
  | "delivered" // se envio a un canal real (Instagram/WhatsApp) y el envio confirmo
  | "failed" // canal real pero el envio fallo (o la ruta capturo una excepcion): queda pendiente
  | "simulator" // candidata del simulador (channel "none"): no hay envio externo, no se afirma ni exito ni fallo
  | "not-sent"; // no habia nada que enviar (sin mensaje propuesto)

/**
 * Decide el veredicto de entrega a partir de la respuesta de la API. `deliveryError` lo marca la ruta cuando
 * la entrega lanzo una excepcion (el mensaje ya se persistio pero NO salio). `sentToCandidate` null = no se
 * envio; objeto con channel "none" = simulador; objeto con delivered true = entregado de verdad.
 */
export function classifyDelivery(sentToCandidate: SentToCandidate | null | undefined, deliveryError?: boolean): DeliveryVerdict {
  if (deliveryError) return "failed";
  if (!sentToCandidate) return "not-sent";
  if (sentToCandidate.channel === "none") return "simulator";
  return sentToCandidate.delivered === true ? "delivered" : "failed";
}

/** true SOLO cuando el mensaje llego de verdad a un canal real de la candidata. */
export function wasDeliveredToCandidate(sentToCandidate: SentToCandidate | null | undefined, deliveryError?: boolean): boolean {
  return classifyDelivery(sentToCandidate, deliveryError) === "delivered";
}
