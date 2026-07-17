/**
 * Reproduce con OPENAI REAL el bug que Alex cazó en su 2ª prueba E2E (caso "Laura", 17-jul): con el Encaja
 * ya dado, ella pasa su teléfono y el bot le suelta "Lo hablo con mi socio y te digo para la llamada".
 *
 * POR QUÉ ESTE SCRIPT: la suite corre SIN OpenAI, así que el fix anterior "pasaba" en tests y fallaba en
 * producción — en producción el mensaje lo ESCRIBE el redactor. Esto verifica el camino REAL.
 *
 * Uso: npx tsx scripts/probeEncajaOpenai.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { ConversationEngine } from "../src/application/conversationEngine";
import { createLlmProviders } from "../src/application/llmFactory";
import { createCandidate, normalizeCandidate, type Candidate } from "../src/domain/candidate";
import { InMemoryCandidateRepository } from "../src/infrastructure/repositories/inMemoryCandidateRepository";

function loadEnvLocal(): void {
  if (!existsSync(".env.local")) return;
  for (const rawLine of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const RUNS = Number(process.env.RUNS ?? "3");

// Los 3 escenarios reales. "laura" (COLLECTING_CALL_DETAILS) es el 2º reporte de Alex; "cynthia" (en revisión
// por preguntar el %) es el 1º — el que NO había verificado con OpenAI; "cuando" cubre REQUESTS_CALL.
const SCENARIOS = [
  { id: "laura  (da el tel, concretando)", state: "COLLECTING_CALL_DETAILS", message: "+54 9 11 2345 6789" },
  { id: "cynthia(da el tel, EN REVISIÓN)", state: "HUMAN_INTERVENTION_REQUIRED", message: "+54 9 11 2345 6789" },
  { id: "cuando (pide la llamada)", state: "HUMAN_INTERVENTION_REQUIRED", message: "y cuando me llamas?" }
] as const;

async function main(): Promise<void> {
  loadEnvLocal();
  process.env.LLM_MODE = "OPENAI";
  const providers = createLlmProviders();
  if (providers.config.llmMode !== "OPENAI") {
    console.error("!! Sin OPENAI_API_KEY -> abortado.");
    process.exit(1);
  }
  console.log(`Modelo: ${providers.config.writingModel} — ${RUNS} pasadas\n`);

  let socioLeaks = 0;
  for (const scenario of SCENARIOS) {
    console.log(`--- ${scenario.id} ---`);
    for (let i = 0; i < RUNS; i++) {
      await runOne(providers, scenario, i, (leaked) => {
        if (leaked) socioLeaks++;
      });
    }
    console.log("");
  }
  console.log(socioLeaks === 0 ? "✅ ARREGLADO: 0 fugas del socio" : `❌ SIGUE ROTO: ${socioLeaks} fugas`);
}

async function runOne(
  providers: ReturnType<typeof createLlmProviders>,
  scenario: (typeof SCENARIOS)[number],
  i: number,
  onResult: (leaked: boolean) => void
): Promise<void> {
  {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: providers.understandingProvider,
      draftingProvider: providers.draftingProvider,
      automationMode: providers.config.automationMode
    });
    const user = `probe_${scenario.state}_${i}`;
    // Encaja YA dado, ella acaba de proponer hora y el bot ya le pidió el teléfono -> aquí salía el socio.
    const candidate: Candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: user }),
      name: "Laura",
      age: 42,
      isAdultConfirmed: true,
      hasOnlyFans: false,
      deviceModel: "iPhone 13",
      deviceEligibility: "APPROVED",
      currentState: scenario.state,
      humanFitDecision: "APPROVED",
      conversationHistory: [
        {
          role: "agent",
          content: "Buenas noticias, hemos revisado tu perfil y nos encaja. Que dia y a que hora te viene mejor?",
          timestamp: new Date().toISOString()
        },
        { role: "candidate", content: "pues ahora en 5 minutos", timestamp: new Date().toISOString() },
        {
          role: "agent",
          content: "perfecto, en 5 min me va bien. Pasame tu numero de telefono",
          timestamp: new Date().toISOString()
        }
      ]
    } as unknown as Candidate);
    await repository.saveCandidate(candidate);

    const result = await engine.handleIncomingMessage({ instagramUsername: user, message: scenario.message });
    const leak = /con (?:mi|el) socio/i.test(result.response);
    onResult(leak);
    console.log(`  [${i + 1}] ${leak ? "❌ FUGA DEL SOCIO" : "✅ ok"} ${JSON.stringify(result.response)}`);
  }
}

void main();
