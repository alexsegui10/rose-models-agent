import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { createLlmProviders } from "@/application/llmFactory";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import type { ProfileVisibility } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

/**
 * Validación con OpenAI REAL (fidelidad elegida por Alex 15-jun): comprueba que la comprensión real de
 * OpenAI no rompe el flujo que va bien en determinista y enseña la VOZ que el modelo redacta en
 * objeciones/explicaciones. GASTA créditos de OpenAI, por eso NO corre en `npm test` (guard RUN_OPENAI_SIM=1).
 *
 * Ejecutar:  RUN_OPENAI_SIM=1 npx vitest run tests/conversationSimulationOpenai.test.ts
 * Lee la clave de .env.local (no se imprime). Sube el timeout para que use OpenAI de verdad (no el
 * fallback determinista por el techo de 4s pensado para Vercel).
 */

// Carga .env.local en process.env SIN exponer valores (necesario porque vitest no lo carga solo).
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

interface Scenario {
  id: string;
  title: string;
  profileVisibility?: ProfileVisibility;
  messages: string[];
}

// Foco en turnos que SÍ pasan por OpenAI (comprensión en todos; redacción en objeciones/negocio).
const SCENARIOS: Scenario[] = [
  {
    id: "oa-happy-no-of",
    title: "Camino feliz (valida comprension real: nombre/edad/OF/movil)",
    profileVisibility: "PUBLIC",
    messages: [
      "hola, me interesa",
      "me llamo ana",
      "tengo 24",
      "no, nunca he tenido of",
      "tengo un iphone 13",
      "cuando hablamos?",
      "el lunes por la tarde"
    ]
  },
  {
    id: "oa-how-it-works",
    title: "Como funciona (voz redactada por OpenAI)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "y como funciona esto exactamente? que tengo que hacer yo?"]
  },
  {
    id: "oa-salary",
    title: "Salario fijo vs porcentaje",
    profileVisibility: "PUBLIC",
    messages: ["hola me interesa", "esto es un sueldo fijo o como?"]
  },
  {
    id: "oa-percentage-exact",
    title: "Pregunta la cifra exacta (70/30 solo si pregunta)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "me llamo sara", "27", "y cuanto os llevais vosotros exactamente?"]
  },
  {
    id: "oa-face",
    title: "Objecion de cara (reconduccion, nunca prometer ocultarla)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "me da cosa salir con la cara, se puede tapar o algo?"]
  },
  {
    id: "oa-scam",
    title: "Desconfianza/estafa",
    profileVisibility: "PUBLIC",
    messages: ["hola", "perdona pero esto me suena a estafa, como se que es de verdad?"]
  },
  {
    id: "oa-multi-agency",
    title: "Ya trabaja con otra agencia",
    profileVisibility: "PUBLIC",
    messages: ["hola", "ya trabajo con otra agencia, puedo estar en dos a la vez?"]
  }
];

const RUN = process.env.RUN_OPENAI_SIM === "1";

describe.skipIf(!RUN)("conversation simulation con OpenAI real (RUN_OPENAI_SIM=1)", () => {
  it("corre escenarios con los proveedores reales y vuelca transcripciones", async () => {
    loadEnvLocal();
    // Para validar de verdad la voz de OpenAI, no queremos que caiga al fallback por el timeout de 4s.
    process.env.OPENAI_TIMEOUT_MS = "30000";
    process.env.OPENAI_MAX_RETRIES = "1";
    process.env.LLM_MODE = "OPENAI";

    const providers = createLlmProviders();
    const transcripts = [];
    for (const scenario of SCENARIOS) {
      const repository = new InMemoryCandidateRepository();
      const engine = new ConversationEngine({
        repository,
        understandingProvider: providers.understandingProvider,
        draftingProvider: providers.draftingProvider,
        automationMode: "AUTOMATIC"
      });
      let candidateId: string | undefined;
      const turns = [];
      for (const message of scenario.messages) {
        const result = await engine.handleIncomingMessage({
          candidateId,
          instagramUsername: scenario.id,
          profileVisibility: scenario.profileVisibility,
          message
        });
        candidateId = result.candidate.id;
        const sent = result.deliveryStatus === "SENT" && !result.automationBlocked && result.response.trim().length > 0;
        turns.push({
          candidate: message,
          intent: result.understanding.intent,
          modelRequiresHumanReview: result.understanding.requiresHumanReview,
          planRequiresHumanReview: result.responsePlan.requiresHumanReview,
          planUncovered: result.responsePlan.uncoveredQuestion,
          knowledgeIds: result.responsePlan.knowledgeEntryIds,
          state: result.candidate.currentState,
          delivery: result.deliveryStatus,
          provider: result.draft.actualProvider,
          usedFallback: result.draft.usedFallback,
          botSends: sent,
          botBurst: sent ? splitIntoMessageBurst(result.response) : [],
          botRaw: result.response
        });
      }
      transcripts.push({
        id: scenario.id,
        title: scenario.title,
        actualProvider: providers.config.llmMode,
        turns
      });
    }

    mkdirSync("data", { recursive: true });
    writeFileSync("data/sim-openai-transcripts.json", JSON.stringify(transcripts, null, 2), "utf8");
    expect(transcripts.length).toBe(SCENARIOS.length);
  }, 300000);
});
