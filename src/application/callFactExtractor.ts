/**
 * Extractor DETERMINISTA de hechos que la candidata dice DURANTE la llamada ("ya tengo OnlyFans",
 * "soy de Córdoba", "tengo 24"). Produce frases cortas en español que se inyectan
 * al brief del redactor para que:
 *  - NO le vuelva a preguntar lo que ya dijo (naturalidad: escuchar de verdad), y
 *  - pueda referenciarlo cuando toque.
 *
 * Es regex puro (sin LLM) y NO decide nada de negocio: solo RECUERDA (invariante 1: la relevancia y el
 * flujo siguen siendo del director). La minoría de edad NO se trata aquí: la corta el clasificador
 * (señal `underage`) con prioridad máxima; este extractor solo registra edades adultas (>=18).
 *
 * LA CARA NO se recuerda como hecho (barrido 20-jul): guardar "No quiere enseñar la cara" y pasárselo al
 * redactor como dato a "referenciar/no re-preguntar" EMPUJABA al LLM a ACEPTAR trabajar sin cara ("apuntado
 * lo de la cara, sin problema") — lo contrario de la política. El rechazo de la cara lo gestiona el director
 * de forma DETERMINISTA (RECONDUCT_FACE insiste; CLOSE_FACE_REJECTED cierra), que es la invariante DURA: la
 * cara es imprescindible. Por eso aquí NO se registra. NO_FACE se conserva solo para NO colar un rechazo de
 * cara como "límite de contenido" genérico.
 */

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// "estoy en X" capturado por CITY que NO es una ciudad: lleva determinante (una reunion, el trabajo, mi casa)
// o es una actividad/lugar-no-ciudad frecuente. Evita el hecho falso "Es de / está en una reunion" (20-jul).
function isNonPlace(captured: string): boolean {
  return (
    /^(?:un|una|el|la|mi|tu|su|los|las|unos|unas)\b/.test(captured) ||
    /^(?:casa|reunion|clase|cama|ducha|bano|trabajo|curro|gym|gimnasio|oficina|misa|cita|ello|eso)\b/.test(captured)
  );
}

const HAS_ONLYFANS = /\b(?:ya )?tengo (?:una )?(?:cuenta de )?only ?fans\b|\bmi only ?fans\b|\bya estoy en only ?fans\b/;
const NO_ONLYFANS = /\bno tengo only ?fans\b|\bnunca (?:he )?(?:tenido|use|usado) only ?fans\b|\btodavia no tengo only ?fans\b/;
const NO_FACE =
  /\bsin (?:ensenar|mostrar|sacar) (?:la |mi )?cara\b|\bno (?:quiero|pienso|suelo)? ?(?:ensenar|mostrar|sacar) (?:la |mi )?cara\b|\bcon la cara no\b|\bla cara no\b/;
const CONTENT_LIMIT = /\bno (?:hago|haria|quiero hacer|me siento comoda (?:con|haciendo))\s+([^,.!?]{3,45})/;
const OTHER_AGENCY = /\b(?:estoy|trabajo|estuve|trabaje) con (?:otra|una) agencia\b|\btengo (?:otra|una) agencia\b/;
const STATED_AGE = /\btengo\s+(1[89]|[2-5]\d)(?:\s*(?:anos|anitos))?\b(?!\s*(?:seguidor|foto|video|mensaj|euro|hij|gat|perr))/;
const CITY = /\b(?:soy de|vivo en|estoy en|te hablo desde)\s+([a-z][a-z ]{2,25}?)(?=[,.!?]|\s+y\b|\s+pero\b|$)/;

/**
 * Extrae los hechos de una lista de frases de la candidata (todas las de la llamada, en orden).
 * Devuelve frases cortas deduplicadas, listas para el brief del redactor.
 */
export function extractCallFacts(utterances: readonly string[]): string[] {
  const facts: string[] = [];
  for (const raw of utterances) {
    const text = normalize(raw ?? "");
    if (text.length === 0) continue;

    if (NO_ONLYFANS.test(text)) {
      facts.push("Aún no tiene OnlyFans (empezaría de cero).");
    } else if (HAS_ONLYFANS.test(text)) {
      facts.push("Ya tiene cuenta de OnlyFans.");
    }
    // La CARA NO se guarda como hecho (ver cabecera): el director la gestiona determinista. NO_FACE solo
    // evita que un rechazo de cara se cuele como "límite de contenido" genérico (guard de CONTENT_LIMIT abajo).
    const limit = text.match(CONTENT_LIMIT);
    if (limit && !NO_FACE.test(limit[0])) {
      facts.push(`Ha dicho un límite: no hace ${limit[1].trim()}.`);
    }
    if (OTHER_AGENCY.test(text)) {
      facts.push("Trabaja (o trabajó) con otra agencia.");
    }
    const age = text.match(STATED_AGE);
    if (age) {
      facts.push(`Ha dicho que tiene ${age[1]} años.`);
    }
    const city = text.match(CITY);
    // "estoy en X" no siempre es lugar ("estoy en una reunión", "en el trabajo", "en clase"): se descarta si
    // el capturado va con determinante (un/una/el/la/mi...) o es una actividad común, no una ciudad (20-jul).
    if (city && !isNonPlace(city[1].trim())) {
      facts.push(`Es de / está en ${city[1].trim()}.`);
    }
  }
  return [...new Set(facts)];
}
