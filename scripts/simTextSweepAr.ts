/**
 * Barrido E2E del bot de TEXTO con candidatas AR CONDUCIDAS POR IA (15-jul): equivalente de texto al
 * _callSweepAr de voz. Una IA (gpt-5.4) hace de candidata argentina realista (personas variadas) y le
 * escribe DMs al MOTOR REAL (handleIncomingMessage con OpenAI real) turno a turno -> transcript. Sirve para
 * cazar incoherencias/contexto/sinsentidos que un guion fijo no destapa.
 * Uso: `OPENAI_WRITING_MODEL=gpt-5.4 npx tsx scripts/simTextSweepAr.ts`. Necesita OPENAI_API_KEY en .env.local.
 * Filtrar personas: SWEEP_PERSONAS=laura,regatea,menor ...
 */
import { readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { ConversationEngine } from "../src/application/conversationEngine";
import { createLlmProviders } from "../src/application/llmFactory";
import { InMemoryCandidateRepository } from "../src/infrastructure/repositories/inMemoryCandidateRepository";

const OUT =
  "C:/Users/Alex/AppData/Local/Temp/claude/c--Users-Alex-Desktop-proyecto1/602e1a8d-92ac-44c0-9d72-e4e97006ef98/scratchpad/textSweep.txt";
const MAX_TURNS = 16;

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* sin .env.local */
  }
}

interface Persona {
  id: string;
  ficha: string;
  persona: string;
}

const PERSONAS: Persona[] = [
  {
    id: "laura-completa-pregunta",
    ficha: "Te llamas Laura, 29, no tenes OnlyFans, iPhone 14.",
    persona:
      "Sos normal y colaboradora, pero tenes la costumbre de RESPONDER una cosa Y preguntar otra en el MISMO mensaje ('no tengo of igual, oye la cuenta la abro yo o ustedes?'). Preguntas cosas de proceso: quien abre la cuenta, si es desde casa, si te ayudan con las fotos."
  },
  {
    id: "regatea",
    ficha: "Sos Sol, 31, SI tenes OnlyFans hace un anio, no trabajas con agencia, iPhone 14.",
    persona:
      "Regateas el reparto sin parar: '30 para mi es poco', 'en otra agencia me daban el 50', 'no me podes mejorar?', 'y si llego a mucho me subis?'. Sos avispada."
  },
  {
    id: "menor-cuela",
    ficha: "En realidad tenes 17 (SOS MENOR), iPhone 11. Al principio no lo decis.",
    persona:
      "Sos entusiasta. A mitad de charla se te escapa la edad real: 'ah pero tengo 17, igual en dos meses cumplo, no pasa nada no?'. En algun momento dejas claro que tenes 17."
  },
  {
    id: "desconfiada",
    ficha: "Sos Romina, 29, no tenes OnlyFans, iPhone 13.",
    persona:
      "Muy desconfiada, cortante: 'como se que no me estafan?', 'esto es legal?', 'quien me dice que me van a pagar?'. Cuesta que sueltes tus datos."
  },
  {
    id: "no-entiende",
    ficha: "Sos Marta, 45, no tenes OnlyFans, un iPhone que te regalo tu hija.",
    persona:
      "No entendes los terminos: 'que es monetizar?', 'que es un chatter?', 'que es el trafico?', 'no te entiendo'. Amable pero perdida."
  },
  {
    id: "contradictoria",
    ficha: "Sos Vanina, 33, iPhone 13. Con el OnlyFans te contradecis.",
    persona:
      "Te contradecis: primero 'no tengo OnlyFans', despues 'ah si tengo pero abandonado', despues 'lo abri pero nunca subi nada'. A ver si el bot se acuerda."
  },
  {
    id: "fuera-guion",
    ficha: "Sos Noelia, 30, no tenes OnlyFans, iPhone 13.",
    persona:
      "Preguntas cosas fuera del guion: 'cuantos seguidores voy a tener?', 'y si me quiero salir a los dos meses?', 'pago impuestos?', 'esto es legal en Argentina?', 'tienen oficina?', 'cuantas chicas llevan?'."
  },
  {
    id: "apurada",
    ficha: "Sos Daniela, 36, SI tenes OnlyFans, no agencia, iPhone 15.",
    persona: "Apurada: 'decime rapido', 'al grano', 'cuanto se gana?', 'que tengo que hacer?'. Queres lo importante ya."
  },
  {
    id: "cara",
    ficha: "Sos Priscila, 28, no tenes OnlyFans, iPhone 13.",
    persona:
      "Te preocupa la cara: 'tengo que mostrar la cara?', 'se puede tapar?', 'y si me reconoce alguien?'. Insistis con eso."
  },
  {
    id: "entusiasta",
    ficha: "Sos Brenda, 26, no tenes OnlyFans, iPhone 14.",
    persona:
      "Super entusiasta y corres: 'si dale quiero', 'cuando arranco?', 'cuando cobro?', 'firmo ya'. Vas mas rapido que el guion."
  },
  {
    id: "monosilabica",
    ficha: "Sos Carla, 41, no tenes OnlyFans, un Samsung viejo (Galaxy A10).",
    persona: "Seca y monosilabica: 'aja', 'si', 'mmm', 'ni idea', 'puede ser', 'no se'. Cuesta sacarte info."
  },
  {
    id: "socio-pregunta",
    ficha: "Sos Flor, 32, no tenes OnlyFans, iPhone 13.",
    persona:
      "Colaboradora. Cuando el bot dice que lo comenta con su socio, preguntas cosas ('cuanto tardan?', 'y si no le gusto?'). Despues te quedas tranquila."
  }
];

async function candidateSays(client: OpenAI, p: Persona, history: { role: string; content: string }[]): Promise<string> {
  const system = `Sos una mujer argentina. Una agencia que gestiona cuentas de OnlyFans te escribio por Instagram DM y estas chateando con el reclutador.
TU FICHA (responde con esto si te lo preguntan): ${p.ficha}
TU PERSONALIDAD: ${p.persona}
REGLAS: Escribis en espaniol RIOPLATENSE coloquial de DM real (che, dale, posta, re, ni idea, minusculas, con typos ocasionales). Mensajes CORTOS de chat (una o dos frases). No seas mas lista ni mas cooperativa de lo que marca tu personalidad. NUNCA rompas personaje, NUNCA digas que sos IA, solo escribi como ella el proximo mensaje.`;
  const input = [
    { role: "system" as const, content: system },
    ...history.map((m) => ({ role: m.role === "assistant" ? ("user" as const) : ("assistant" as const), content: m.content }))
  ];
  try {
    const resp = await client.responses.create(
      { model: "gpt-5.4", input, temperature: 1, max_output_tokens: 60 },
      { signal: AbortSignal.timeout(20000) }
    );
    const text = (resp.output_text ?? "").trim().replace(/^["']|["']$/g, "");
    return text.length > 0 ? text : "aja";
  } catch {
    return "dale";
  }
}

async function runChat(engine: ConversationEngine, client: OpenAI, p: Persona, out: string[]) {
  out.push(`\n\n######## ${p.id} ########\nFICHA: ${p.ficha}\nPERSONA: ${p.persona}`);
  const username = `sweep_${p.id}_${Math.random().toString(36).slice(2, 7)}`;
  const history: { role: string; content: string }[] = [];
  let candidateId: string | undefined;
  // Primer mensaje de ella (llega el DM).
  let her = await candidateSays(client, p, [{ role: "assistant", content: "(te acaban de escribir por DM)" }]);
  for (let t = 0; t < MAX_TURNS; t++) {
    out.push(`ELLA: ${her}`);
    history.push({ role: "user", content: her });
    const result = await engine.handleIncomingMessage(
      candidateId
        ? { candidateId, instagramUsername: username, message: her }
        : { instagramUsername: username, profileVisibility: "PUBLIC", message: her }
    );
    candidateId = result.candidate.id;
    const botMsg = result.response?.trim() ? result.response.replace(/\n+/g, " / ") : "(en visto)";
    out.push(`BOT [${result.candidate.currentState}]: ${botMsg}`);
    if (result.response?.trim()) history.push({ role: "assistant", content: result.response });
    if (result.candidate.currentState === "CLOSED") break;
    her = await candidateSays(client, p, history);
  }
}

async function main() {
  loadEnvLocal();
  process.env.LLM_MODE = "OPENAI";
  const providers = createLlmProviders();
  if (providers.config.llmMode !== "OPENAI") {
    console.error("!! Sin OPENAI_API_KEY -> abortado.");
    process.exit(1);
  }
  const only = (process.env.SWEEP_PERSONAS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chosen = only.length > 0 ? PERSONAS.filter((p) => only.includes(p.id)) : PERSONAS;
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: providers.understandingProvider,
    draftingProvider: providers.draftingProvider,
    automationMode: providers.config.automationMode
  });
  const out: string[] = [`Barrido texto AR — modelo ${providers.config.writingModel} — ${chosen.length} personas`];
  for (const p of chosen) {
    console.log(`... ${p.id}`);
    await runChat(engine, client(providers), p, out);
  }
  writeFileSync(OUT, out.join("\n"), "utf8");
  console.log(`\nTranscript -> ${OUT}`);
}

function client(providers: ReturnType<typeof createLlmProviders>): OpenAI {
  return new OpenAI({ apiKey: providers.config.openaiApiKey as string });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
