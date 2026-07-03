/**
 * Sonda de PREGUNTAS de candidatas (3-jul): pasa una batería de preguntas realistas por el MISMO camino
 * que la llamada en vivo (clasificador + recuperador de conocimiento con ignoreStateGating + blocklist)
 * y reporta qué señal/directiva produciría cada una. Objetivo: cazar todos los "lo hablo con mi socio"
 * evitables (DEFER solo debe quedar para lo desconocido E importante — decisión de Alex).
 *
 * Uso: npx vite-node --config vitest.config.ts scripts/callQuestionProbe.ts
 * Determinista: NO llama a OpenAI (la señal y la cobertura no dependen del redactor).
 */

import { businessKnowledgeEntries } from "@/content/business";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";

const retriever = new LocalBusinessKnowledgeRetriever(businessKnowledgeEntries);
const callCandidate = normalizeCandidate({
  ...createCandidate({ instagramUsername: "probe" }),
  currentState: "CALL_IN_PROGRESS"
});
const BLOCKLIST = new Set(["call-details-after-review", "call-post-summary"]);

// Última frase típica del bot (para las señales de aclaración): la del dinero, la más densa.
const LAST_BOT =
  "Y ahora lo importante, el dinero: el reparto es un 30% para ti y un 70% para la agencia. El dinero lo cobras tú primero en tu cuenta y cobras cada 14 días. ¿Qué te parece?";

interface Probe {
  category: string;
  question: string;
}

const BATTERY: Probe[] = [
  // --- Dinero y pagos ---
  { category: "pagos", question: "¿cuando cobro yo exactamente?" },
  { category: "pagos", question: "¿como me llega la plata a mi?" },
  { category: "pagos", question: "¿me pagais por transferencia o como?" },
  { category: "pagos", question: "¿que es skrill?" },
  { category: "pagos", question: "¿puedo cobrar en dolares?" },
  { category: "pagos", question: "¿y si onlyfans no me deja cobrar en argentina?" },
  { category: "pagos", question: "¿hay sueldo fijo o algo minimo?" },
  { category: "pagos", question: "¿quien paga los gastos de la cuenta?" },
  { category: "pagos", question: "¿cuanto os llevais vosotros?" },
  { category: "pagos", question: "¿cuanto ganaria yo al mes mas o menos?" },
  // --- Contrato y compromiso ---
  { category: "contrato", question: "¿el contrato me ata mucho tiempo?" },
  { category: "contrato", question: "¿puedo salirme cuando quiera?" },
  { category: "contrato", question: "¿que pasa si a los dos meses no me gusta?" },
  { category: "contrato", question: "¿el contrato es legal en argentina?" },
  { category: "contrato", question: "¿tengo que firmar algo ya?" },
  { category: "contrato", question: "¿me mandas el contrato antes de decidir?" },
  // --- Impuestos / legal (DEFER esperado: importante y no documentado) ---
  { category: "impuestos", question: "¿y los impuestos como van alla?" },
  { category: "impuestos", question: "¿tengo que declarar esto en argentina?" },
  { category: "impuestos", question: "¿hace falta ser autonoma o algo?" },
  // --- Privacidad / cara / familia ---
  { category: "privacidad", question: "¿y si me ve mi familia?" },
  { category: "privacidad", question: "¿mis conocidos pueden encontrar la cuenta?" },
  { category: "privacidad", question: "¿se puede bloquear argentina para que no me vean?" },
  { category: "privacidad", question: "¿tengo que salir con la cara si o si?" },
  { category: "privacidad", question: "¿puedo usar otro nombre?" },
  { category: "privacidad", question: "¿mis fotos pueden acabar en otro lado?" },
  // --- Contenido ---
  { category: "contenido", question: "¿que tipo de fotos tengo que hacer?" },
  { category: "contenido", question: "¿tengo que hacer videos muy fuertes?" },
  { category: "contenido", question: "¿cuantas horas al dia me lleva esto?" },
  { category: "contenido", question: "¿necesito una camara buena o vale el movil?" },
  { category: "contenido", question: "¿me ayudais con ideas para el contenido?" },
  { category: "contenido", question: "¿el contenido lo subo yo o vosotros?" },
  // --- Plataforma / mecánica ---
  { category: "mecanica", question: "¿la cuenta de instagram es mia o vuestra?" },
  { category: "mecanica", question: "¿la cuenta de onlyfans la abro yo?" },
  { category: "mecanica", question: "¿necesito verificarme en onlyfans con mi dni?" },
  { category: "mecanica", question: "¿quien contesta los mensajes de los clientes?" },
  { category: "mecanica", question: "¿que pasa si la cuenta no crece?" },
  { category: "mecanica", question: "¿en que paises se ve mi contenido?" },
  // --- Agencia / confianza ---
  { category: "confianza", question: "¿cuanto tiempo llevais con la agencia?" },
  { category: "confianza", question: "¿con cuantas chicas trabajais?" },
  { category: "confianza", question: "¿me puedes pasar alguna referencia de otra chica?" },
  { category: "confianza", question: "¿donde estais ubicados?" },
  { category: "confianza", question: "¿esto es seguro de verdad?" },
  { category: "confianza", question: "¿como se que no me vais a estafar?" },
  // --- Exclusividad / otras agencias ---
  { category: "exclusividad", question: "¿puedo seguir con mi otra agencia a la vez?" },
  { category: "exclusividad", question: "ya tengo onlyfans, ¿me sirve la cuenta que tengo?" },
  // --- Proceso ---
  { category: "proceso", question: "¿cuando empezariamos?" },
  { category: "proceso", question: "¿que es lo siguiente que tengo que hacer?" },
  { category: "proceso", question: "¿cuanto tarda en verse dinero?" },
  // --- Personales / chit-chat (no negocio: salir del paso con simpatía, no socio) ---
  { category: "personal", question: "¿tu de donde eres?" },
  { category: "personal", question: "¿cuantos años tienes tu?" },
  { category: "personal", question: "¿tu tambien tienes onlyfans? jaja" },
  { category: "personal", question: "¿estas soltero? jaja" },
  { category: "personal", question: "¿que hora es alli en españa?" },
  // --- Aclaraciones sobre lo dicho ---
  { category: "aclaracion", question: "¿que significa se liquida?" },
  { category: "aclaracion", question: "¿reparto de que?" },
  { category: "aclaracion", question: "¿a que te refieres?" },
  // --- Identidad / bot ---
  { category: "identidad", question: "¿quien eres tu exactamente?" },
  { category: "identidad", question: "¿eres un robot?" },
  { category: "identidad", question: "¿de que agencia me llamas?" },
  // --- Bordes ---
  { category: "borde", question: "¿que edad hay que tener para esto?" },
  { category: "borde", question: "¿me haceis fotos vosotros o las hago yo?" },
  { category: "borde", question: "¿esto es porno o que es exactamente?" },
  { category: "borde", question: "¿mi novio puede salir en los videos?" },
  { category: "borde", question: "¿que pasa si me arrepiento de una foto ya subida?" },
  { category: "borde", question: "¿me podeis borrar el contenido si lo dejo?" }
];

(async () => {
  const rows: Array<{ category: string; question: string; signal: string; entries: string[] }> = [];
  for (const probe of BATTERY) {
    const entries = (
      await retriever.retrieve({
        candidate: callCandidate,
        intent: "REQUESTS_INFORMATION",
        question: probe.question,
        limit: 3,
        ignoreStateGating: true
      })
    ).filter((e) => !BLOCKLIST.has(e.id));
    const signal = classifyCallSignal({
      utterance: probe.question,
      isCoveredQuestion: entries.length > 0,
      lastBotUtterance: LAST_BOT
    });
    rows.push({ category: probe.category, question: probe.question, signal, entries: entries.map((e) => e.id) });
  }

  const defers = rows.filter((r) => r.signal === "asks-unknown");
  const answered = rows.filter((r) => r.signal !== "asks-unknown");
  console.log(`TOTAL: ${rows.length} | responde/gestiona: ${answered.length} | DEFIERE (socio/WhatsApp): ${defers.length}\n`);
  console.log("======== DEFIERE (revisar uno a uno) ========");
  for (const r of defers) console.log(`[${r.category}] ${r.question}`);
  console.log("\n======== RESPONDE/GESTIONA ========");
  for (const r of answered) {
    console.log(`[${r.category}] ${r.question} -> ${r.signal}${r.entries.length ? ` (${r.entries[0]})` : ""}`);
  }
})();
