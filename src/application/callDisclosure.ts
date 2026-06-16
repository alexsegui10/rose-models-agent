/**
 * Locución de apertura de la llamada (paso 0, determinista). La emite el director con GIVE_DISCLOSURE
 * y la dice el bot ANTES de nada. Cumple, controlado por código:
 *  - EU AI Act Art. 50: declarar que es un asistente automatizado (IA).
 *  - RGPD: avisar de la grabación (si se graba).
 *  - Buena práctica: ofrecer hablar con una persona.
 *
 * El wording exacto y la "finalidad" de la grabación los aprueba Alex (texto DRAFT). El bot NUNCA debe
 * arrancar la parte sustantiva sin haber dicho esto.
 */

export interface CallOpeningDisclosureInput {
  /** Nombre de la candidata, si se conoce (para personalizar el saludo). */
  candidateName?: string;
  /** ¿Se graba/transcribe la llamada? Por defecto sí (hay que avisar). Si es false, se omite ese aviso. */
  recorded?: boolean;
}

/** Devuelve el texto de apertura legal de la llamada. */
export function callOpeningDisclosure(input: CallOpeningDisclosureInput = {}): string {
  const name = input.candidateName?.trim();
  const greeting = name ? `Hola ${name}` : "Hola";
  const recordingClause = input.recorded === false ? "" : " y de que la llamada se graba para gestionar tu alta";
  return (
    `${greeting}, soy el asistente de Rose Models, hablamos por Instagram. ` +
    `Te aviso de que soy un asistente automatizado${recordingClause}. ` +
    `Si en algún momento prefieres hablar directamente con una persona, dímelo y te paso con Alex. ` +
    `¿Te va bien que te cuente cómo trabajamos?`
  );
}
