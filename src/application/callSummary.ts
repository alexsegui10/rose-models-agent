import { callAgendaStage } from "./callAgenda";
import type { CallHandoffReason } from "./callDirector";
import type { CallTranscriptFacts } from "./callTranscriptAnalysis";

/**
 * Resumen de la llamada EN ESPAÑOL y DETERMINISTA (jul-2026): el `transcript_summary` de ElevenLabs llega
 * en inglés y Alex no lo lee — y el CRM entero es en español. Se construye desde los HECHOS del replay
 * (analyzeCallTranscript): mismo cerebro que decidió en vivo, cero LLM, cero idioma sorpresa (invariante 6:
 * nada que presentar como IA porque no lo es). El resumen de ElevenLabs se descarta (queda en su dashboard).
 */

const HANDOFF_LABELS: Record<CallHandoffReason, string> = {
  "asked-for-human": "pidió hablar con una persona",
  "suspicion-or-aggression": "hubo desconfianza grave u hostilidad",
  "share-rejected-at-floor": "rechazó el reparto incluso en el suelo (60/40)",
  "audio-unintelligible": "el audio no se entendía"
};

export function buildSpanishCallSummary(input: {
  outcome: "COMPLETED" | "NO_ANSWER";
  durationSec?: number;
  facts: CallTranscriptFacts;
}): string {
  const { outcome, durationSec, facts } = input;
  const duration = formatDuration(durationSec);

  if (outcome === "NO_ANSWER") {
    const base = facts.candidateTurns === 0 ? "No contestó (o saltó el buzón)" : "Llamada sin conversación útil";
    return `${base}${duration ? ` · ${duration}` : ""}.`;
  }

  const parts: string[] = [];
  parts.push(`Llamada de ${duration || "duración desconocida"}.`);

  if (facts.underage) {
    parts.push("SEGURIDAD: declaró ser MENOR durante la llamada — quedó cerrada.");
    return parts.join(" ");
  }

  if (facts.coveredStages.length > 0) {
    const labels = facts.coveredStages.map((id) => callAgendaStage(id).label.toLowerCase());
    parts.push(`Se explicó: ${labels.join(", ")}.`);
  }

  if (typeof facts.negotiatedModelShare === "number") {
    parts.push(
      facts.negotiatedModelShare === 30
        ? "Reparto presentado: 70/30 (sin negociar)."
        : `Reparto negociado: quedó en ${facts.negotiatedModelShare}% para ella.`
    );
  }

  if (facts.handedOff) {
    parts.push(`OJO: terminó transferida a ti (${HANDOFF_LABELS[facts.handoffReason ?? "asked-for-human"]}).`);
  } else if (facts.rescheduleRequested) {
    parts.push("La pilló en mal momento: se reabre el agendado por Instagram.");
  } else if (facts.closedWithContract) {
    parts.push("Cerró bien: queda enviarle el contrato y las guías por WhatsApp.");
  }

  if (facts.deferredQuestions > 0) {
    parts.push(
      facts.deferredQuestions === 1
        ? "1 duda quedó pendiente de confirmarle por WhatsApp."
        : `${facts.deferredQuestions} dudas quedaron pendientes de confirmarle por WhatsApp.`
    );
  }

  return parts.join(" ");
}

function formatDuration(durationSec?: number): string {
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) return "";
  const minutes = Math.floor(durationSec / 60);
  const seconds = Math.round(durationSec % 60);
  if (minutes === 0) return `${seconds} s`;
  return `${minutes} min ${seconds.toString().padStart(2, "0")} s`;
}
