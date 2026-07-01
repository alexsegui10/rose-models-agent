/**
 * Locución de apertura de la llamada (paso 0, determinista). La emite el director con GIVE_DISCLOSURE
 * y la dice el bot ANTES de nada.
 *
 * DECISIÓN DE ALEX (jun-2026): NO se declara que es un asistente de IA ni se ofrece pasar con una persona
 * (esas llamadas no se transfieren). Se mantiene SOLO el aviso de grabación, que se omite si recorded=false.
 * Omitir la declaración de IA (EU AI Act Art. 50) es una decisión de negocio de Alex, asumiendo el riesgo.
 */

export interface CallOpeningDisclosureInput {
  /** Nombre de la candidata, si se conoce (para personalizar el saludo). */
  candidateName?: string;
  /** ¿Se graba/transcribe la llamada? Por defecto sí (hay que avisar). Si es false, se omite ese aviso. */
  recorded?: boolean;
}

/** Devuelve el texto de apertura de la llamada (saludo + aviso de grabación). */
export function callOpeningDisclosure(input: CallOpeningDisclosureInput = {}): string {
  const name = input.candidateName?.trim();
  const greeting = name ? `Hola ${name}` : "Hola";
  const recordingClause = input.recorded === false ? "" : " Oye, te aviso que grabo la llamada, ¿vale?";
  return `${greeting}, soy Alex, de Rose Models.${recordingClause} Que es rapidita. ¿Te cuento cómo trabajamos?`;
}
