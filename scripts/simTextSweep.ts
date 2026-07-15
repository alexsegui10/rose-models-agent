/**
 * Barrido E2E del bot de TEXTO con OpenAI real (Alex 15-jul): varias candidatas realistas que COMPLETAN el
 * guion en el mismo turno en que dicen/preguntan algo, para confirmar que:
 *   1. Laura (pregunta cubierta de proceso) -> responder -> pitch -> socio (bug arreglado).
 *   2. Negociacion al completar -> NUNCA pitch, cae en revision, sin cifra (invariante 3).
 *   3. Completar limpio (sin pregunta) -> pitch en el turno de completar -> socio (sin regresion).
 *   4. Pregunta de DINERO (no negociacion) al completar -> sin pitch-defer, revision (money guard).
 * Uso: `OPENAI_WRITING_MODEL=gpt-5.4 npx tsx scripts/simTextSweep.ts`. Necesita OPENAI_API_KEY en .env.local.
 */
import { readFileSync } from "node:fs";
import { ConversationEngine } from "../src/application/conversationEngine";
import { createLlmProviders } from "../src/application/llmFactory";
import { InMemoryCandidateRepository } from "../src/infrastructure/repositories/inMemoryCandidateRepository";

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = value;
    }
  } catch {
    /* sin .env.local */
  }
}

interface Scenario {
  name: string;
  expect: string;
  username: string;
  turns: string[];
}

const scenarios: Scenario[] = [
  {
    name: "1. LAURA — completa + pregunta cubierta de proceso",
    expect: "responde su pregunta (QUALIFYING) -> pitch -> socio",
    username: "sim_laura",
    turns: [
      "hola vi lo de modelos",
      "soy laura",
      "29",
      "iphone 14",
      "no tengo of, la cuenta la abro yo o ustedes?",
      "ah dale gracias",
      "listo"
    ]
  },
  {
    name: "2. NEGOCIACION al completar (invariante 3)",
    expect: "NUNCA pitch, cae en revision, SIN 70/30",
    username: "sim_nego",
    turns: ["hola", "sofia", "31", "iphone 13", "no tengo of igual pero quiero el 60 para mi eh", "y bueno?"]
  },
  {
    name: "3. COMPLETA LIMPIO sin pregunta (no regresion)",
    expect: "pitch en el turno de completar -> socio",
    username: "sim_limpio",
    turns: ["buenas", "carla", "34", "iphone 15", "no nunca tuve of", "ok perfecto"]
  },
  {
    name: "4. PREGUNTA DE DINERO al completar (money guard)",
    expect: "sin pitch-defer; revision; cifra solo si pregunta exacta (reactivo)",
    username: "sim_dinero",
    turns: ["hola", "vale me llamo mica", "28", "iphone 14 pro", "no tengo of, che y cuanto se gana con esto?", "ajam"]
  }
];

async function runScenario(engine: ConversationEngine, s: Scenario) {
  console.log(`\n========================================================`);
  console.log(`${s.name}`);
  console.log(`  esperado: ${s.expect}`);
  console.log(`========================================================`);
  let candidateId: string | undefined;
  for (const message of s.turns) {
    const result = await engine.handleIncomingMessage(
      candidateId
        ? { candidateId, instagramUsername: s.username, message }
        : { instagramUsername: s.username, profileVisibility: "PUBLIC", message }
    );
    candidateId = result.candidate.id;
    const resp = (result.response || "(en visto)").replace(/\n+/g, " / ");
    console.log(`\n  👩 ${message}`);
    console.log(`  🤖 [${result.candidate.currentState}] ${resp}`);
  }
}

async function main() {
  loadEnvLocal();
  process.env.LLM_MODE = "OPENAI";
  const providers = createLlmProviders();
  if (providers.config.llmMode !== "OPENAI") {
    console.error("!! Sin OPENAI_API_KEY -> abortado (no simulo en determinista).");
    process.exit(1);
  }
  console.log(`Modelo escritura: ${providers.config.writingModel}\n`);
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: providers.understandingProvider,
    draftingProvider: providers.draftingProvider,
    automationMode: providers.config.automationMode
  });
  for (const s of scenarios) {
    await runScenario(engine, s);
  }
  console.log("\n\n--- fin del barrido ---");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
