/**
 * Locución de apertura de la llamada (paso 0, determinista). La emite el director con GIVE_DISCLOSURE
 * y la dice el bot ANTES de nada.
 *
 * DECISIÓN DE ALEX (jun-2026): NO se declara que es un asistente de IA ni se ofrece pasar con una persona
 * (esas llamadas no se transfieren). Omitir la declaración de IA (EU AI Act Art. 50) es una decisión de
 * negocio de Alex, asumiendo el riesgo.
 *
 * DECISIÓN DE ALEX (jul-2026): la apertura YA NO anuncia que se graba la llamada. La grabación en sí sigue
 * activa en ElevenLabs (para que Alex la revise en el CRM); solo se deja de mencionar. Es REVERSIBLE: el
 * aviso vuelve pasando recorded=true (env CALL_RECORDED=1) — opt-in, por defecto no se dice nada.
 */

export interface CallOpeningDisclosureInput {
  /** Nombre de la candidata, si se conoce (para personalizar el saludo). */
  candidateName?: string;
  /** ¿Se ANUNCIA la grabación en la apertura? Por defecto NO. Solo si es true se añade el aviso (opt-in). */
  recorded?: boolean;
}

/** Devuelve el texto de apertura de la llamada (saludo; el aviso de grabación solo si recorded=true). */
export function callOpeningDisclosure(input: CallOpeningDisclosureInput = {}): string {
  const name = input.candidateName?.trim();
  const greeting = name ? `Hola ${name}` : "Hola";
  const recordingClause = input.recorded === true ? " Oye, te aviso que grabo la llamada, ¿vale?" : "";
  return `${greeting}, soy Alex, de Rose Models.${recordingClause} Que es rapidita. ¿Te cuento cómo trabajamos?`;
}
