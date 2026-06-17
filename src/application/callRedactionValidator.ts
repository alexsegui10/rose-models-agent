/**
 * Validador de la redacción de VOZ. Cuando se conecte el LLM para que redacte natural (a partir del
 * `draftingBrief`), su salida PASA por aquí antes de decirse. Si la viola, se descarta y se usa el
 * `fallbackText` determinista (invariante 6). Es la red de seguridad que protege los invariantes cuando
 * habla el modelo:
 *  - Invariante 3: ningún porcentaje de reparto fuera de los autorizados (70/65/60 y sus complementarios).
 *  - No prometer/cuantificar ingresos (sin cifras de dinero, "ganarás", "X al mes").
 *  - Turnos de voz BREVES (no monólogos).
 *
 * Es deliberadamente CONSERVADOR: ante la duda, invalida y deja hablar al fallback seguro.
 */

import type { CallDraftingBrief } from "./callRedaction";

export interface CallValidationResult {
  valid: boolean;
  reason?: string;
}

/** Porcentajes que el bot PUEDE decir (la escalera autorizada y sus complementarios). */
const AUTHORIZED_SHARE = new Set([70, 65, 60, 30, 35, 40]);

/** Longitud máxima razonable de un turno hablado (un párrafo, no un discurso). */
const MAX_UTTERANCE_LENGTH = 600;

export function validateCallUtterance(text: string, _brief?: CallDraftingBrief): CallValidationResult {
  const trimmed = (text ?? "").trim();
  if (trimmed.length === 0) {
    return { valid: false, reason: "vacío" };
  }
  if (trimmed.length > MAX_UTTERANCE_LENGTH) {
    return { valid: false, reason: "demasiado largo para un turno de voz" };
  }

  const norm = trimmed.toLowerCase();

  // Porcentajes "N%" o "N por ciento": solo los autorizados.
  for (const match of norm.matchAll(/\b(\d{1,3})\s*(?:%|por\s?ciento)/g)) {
    if (!AUTHORIZED_SHARE.has(Number(match[1]))) {
      return { valid: false, reason: `porcentaje no autorizado: ${match[1]}` };
    }
  }

  // Reparto estilo "70/30" o "70-30": ambos lados deben ser autorizados.
  for (const match of norm.matchAll(/\b(\d{1,3})\s*[/-]\s*(\d{1,3})\b/g)) {
    if (!AUTHORIZED_SHARE.has(Number(match[1])) || !AUTHORIZED_SHARE.has(Number(match[2]))) {
      return { valid: false, reason: `reparto no autorizado: ${match[0]}` };
    }
  }

  // Promesa o cifra de ingresos: prohibido (no se prometen ganancias).
  if (/\d[\d.,]*\s*(?:€|euros?|eur\b|dolares?|\$)/.test(norm)) {
    return { valid: false, reason: "cifra de dinero (posible promesa de ingresos)" };
  }
  if (/\bganar[aá]s?\b|\bvas a ganar\b|\bganar[ií]as\b/.test(norm)) {
    return { valid: false, reason: "promesa de ingresos ('ganarás')" };
  }
  if (/\b(al mes|mensual(es)?|por mes|a la semana|semanal)\b[^.?!]*\d/.test(norm)) {
    return { valid: false, reason: "ingreso periódico cuantificado" };
  }

  return { valid: true };
}
