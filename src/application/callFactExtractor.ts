/**
 * Extractor DETERMINISTA de hechos que la candidata dice DURANTE la llamada ("ya tengo OnlyFans",
 * "no enseño la cara", "soy de Córdoba", "tengo 24"). Produce frases cortas en español que se inyectan
 * al brief del redactor para que:
 *  - NO le vuelva a preguntar lo que ya dijo (naturalidad: escuchar de verdad), y
 *  - pueda referenciarlo cuando toque ("como me decías, sin cara, sin problema").
 *
 * Es regex puro (sin LLM) y NO decide nada de negocio: solo RECUERDA (invariante 1: la relevancia y el
 * flujo siguen siendo del director). La minoría de edad NO se trata aquí: la corta el clasificador
 * (señal `underage`) con prioridad máxima; este extractor solo registra edades adultas (>=18).
 */

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
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
    if (NO_FACE.test(text)) {
      facts.push("No quiere enseñar la cara.");
    }
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
    if (city) {
      facts.push(`Es de / está en ${city[1].trim()}.`);
    }
  }
  return [...new Set(facts)];
}
