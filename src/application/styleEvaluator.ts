import { alexStyleProfile } from "@/content/style/alex-style-profile";
import type { Candidate } from "@/domain/candidate";
import type { StyleEvaluation } from "@/domain/styleEvaluation";

const roboticPatterns = [/comprendo perfectamente/i, /procederemos/i, /estimada candidata/i, /en que puedo ayudarte hoy/i];
const argentinianPatterns = [/\bvos\b/i, /\bquer[eé]s\b/i, /\bten[eé]s\b/i];

export interface ResponseStyleEvaluator {
  evaluate(input: { response: string; candidate: Candidate; inboundMessage: string }): Promise<StyleEvaluation>;
}

export class DeterministicResponseStyleEvaluator implements ResponseStyleEvaluator {
  async evaluate(input: { response: string; candidate: Candidate; inboundMessage: string }): Promise<StyleEvaluation> {
    return evaluateResponseStyle(input.response, input.candidate, input.inboundMessage);
  }
}

export function evaluateResponseStyle(response: string, candidate: Candidate, inboundMessage: string): StyleEvaluation {
  const reasons: string[] = [];
  const usesForbiddenExpression = alexStyleProfile.forbiddenExpressions.some((expression) => containsLoose(response, expression));
  const soundsRobotic = roboticPatterns.some((pattern) => pattern.test(response));
  const usesArgentinianSpanish = argentinianPatterns.some((pattern) => pattern.test(response));
  const isTooLong = response.length > 520 || response.split(/\s+/).length > 95;
  const asksTooManyQuestions = (response.match(/\?/g) ?? []).length > 2;
  const isTooFormal = /usted|solicitud|procederemos|departamento|equipo especializado/i.test(response);
  const repeatsKnownInformation = Boolean(candidate.age && new RegExp(`\\b${candidate.age}\\b`).test(response) && /edad/i.test(response));
  const addressesCandidateMessage = addressesMessage(response, inboundMessage);

  if (usesForbiddenExpression) reasons.push("Usa una expresion prohibida o no deseada.");
  if (soundsRobotic) reasons.push("Suena demasiado robotico.");
  if (usesArgentinianSpanish) reasons.push("Imita espanol argentino.");
  if (isTooLong) reasons.push("La respuesta es demasiado larga.");
  if (asksTooManyQuestions) reasons.push("Hace demasiadas preguntas.");
  if (isTooFormal) reasons.push("Suena demasiado formal.");
  if (repeatsKnownInformation) reasons.push("Puede estar repitiendo informacion conocida.");
  if (!addressesCandidateMessage) reasons.push("No responde suficientemente al mensaje de la candidata.");

  const penalty =
    Number(usesForbiddenExpression) * 0.25 +
    Number(soundsRobotic) * 0.18 +
    Number(usesArgentinianSpanish) * 0.25 +
    Number(isTooLong) * 0.15 +
    Number(asksTooManyQuestions) * 0.16 +
    Number(isTooFormal) * 0.12 +
    Number(repeatsKnownInformation) * 0.1 +
    Number(!addressesCandidateMessage) * 0.12;

  const score = Math.max(0, Math.min(1, 1 - penalty));

  return {
    isSpanishFromSpain: !usesArgentinianSpanish,
    soundsNatural: !soundsRobotic && !isTooFormal,
    soundsLikeAlex: score >= 0.75,
    isTooFormal,
    isTooLong,
    soundsRobotic,
    repeatsKnownInformation,
    asksTooManyQuestions,
    usesForbiddenExpression,
    addressesCandidateMessage,
    score,
    reasons
  };
}

function addressesMessage(response: string, inboundMessage: string): boolean {
  const normalizedInbound = inboundMessage.toLowerCase();
  const normalizedResponse = response.toLowerCase();

  if (/telefono|teléfono|\d{3}/.test(normalizedInbound)) return /perfecto|lo tengo|telefono|teléfono|edad|llamada/.test(normalizedResponse);
  if (/llamada|llamar/.test(normalizedInbound)) return /llamada|podemos|edad|valorar/.test(normalizedResponse);
  if (/porcentaje|comision|comisión/.test(normalizedInbound)) return /socio|reviso|calma/.test(normalizedResponse);
  if (/privad/.test(normalizedInbound)) return /privada|solicitud|perfil/.test(normalizedResponse);
  if (/interesa|informacion|información|si|sí/.test(normalizedInbound)) return /edad|experiencia|ciudad|perfil/.test(normalizedResponse);

  return response.trim().length > 0;
}

function containsLoose(response: string, expression: string): boolean {
  return response.toLowerCase().includes(expression.toLowerCase());
}

