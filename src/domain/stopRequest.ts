// Petición EXPLÍCITA de no ser contactada ("no me mandes nada", "déjame en paz"...). Se distingue de un
// rechazo normal ("no me interesa"): ambos cierran la conversación, pero este AVISA al operador y, en el
// re-enganche proactivo, hace que NUNCA se le vuelva a escribir. Vive en domain (función pura, sin I/O)
// para que la usen tanto infrastructure (avisos al operador) como application (planificador de re-enganche)
// sin cruzar capas.
const stopRequestPattern =
  /\b(no me mandes? (?:nada|mas|mensajes)|no me escribas? (?:mas|nada)|dejame en paz|no me contactes|no me molestes|para de escribirme|no me vuelvas a escribir|deja de escribirme|no quiero que me escrib\w*|borrame|bloquea\w*)\b/;

export function isStopRequest(message: string): boolean {
  const normalized = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  return stopRequestPattern.test(normalized);
}
