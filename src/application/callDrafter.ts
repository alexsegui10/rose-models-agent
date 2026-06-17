/**
 * Contrato del "redactor" de voz: a partir del `draftingBrief` (instrucción + hechos aprobados + lo
 * prohibido + contexto de la candidata), produce la frase NATURAL que dirá el bot. Lo implementará un
 * adaptador OpenAI (que se conecta aparte, gateado por config y clave); en tests se inyecta un fake.
 *
 * Devuelve `null` si no puede redactar (timeout, fallo, etc.) → el responder usa el `fallbackText`
 * determinista. Toda salida del redactor PASA por `validateCallUtterance` antes de decirse (invariantes).
 */

import type { CallContext } from "./callContext";
import type { CallDraftingBrief } from "./callRedaction";

export interface CallDraftRequest {
  brief: CallDraftingBrief;
  context?: CallContext;
  /** Tipo de directiva (para trazas/observabilidad). */
  directiveType: string;
}

export interface CallUtteranceDrafter {
  /** Redacta la frase natural a partir del brief, o null si no puede (se usará el fallback determinista). */
  draft(request: CallDraftRequest): Promise<string | null>;
}
