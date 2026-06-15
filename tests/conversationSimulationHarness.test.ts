import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { splitIntoMessageBurst } from "@/domain/conversationBurst";
import type { ProfileVisibility } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

/**
 * Harness de simulación de conversaciones (determinista, gratis, reproducible). NO corre en `npm test`
 * (queda saltado salvo RUN_SIM=1). Mete cada escenario por el motor en modo AUTOMATIC y vuelca las
 * transcripciones a data/sim-transcripts.json para que los jueces (agentes) las evalúen como si fueran
 * Alex. Ejecutar con:  RUN_SIM=1 npx vitest run tests/conversationSimulationHarness.test.ts
 */

interface Scenario {
  id: string;
  title: string;
  profileVisibility?: ProfileVisibility;
  messages: string[];
}

// Cobertura amplia del guión real y de los casos límite (seguridad, objeciones, comercial, agenda).
const SCENARIOS: Scenario[] = [
  {
    id: "happy-no-of",
    title: "Camino feliz, sin OF, iphone, agenda",
    profileVisibility: "PUBLIC",
    messages: [
      "hola, me interesa",
      "me llamo ana",
      "tengo 24",
      "no, nunca",
      "tengo un iphone 13",
      "vale, cuando podemos hablar?",
      "el lunes por la tarde"
    ]
  },
  {
    id: "happy-has-of-no-agency",
    title: "Tiene OF, sin agencia, agenda",
    profileVisibility: "PUBLIC",
    messages: [
      "buenas, vi tu mensaje",
      "soy lucia",
      "25 años",
      "si tengo of",
      "no, nunca con agencias",
      "iphone 14",
      "cuando quieras hablamos",
      "mañana a las 18h"
    ]
  },
  {
    id: "experienced-has-agency",
    title: "Con OF y con otra agencia (experimentada): sin pitch",
    profileVisibility: "PUBLIC",
    messages: ["hola", "marta", "29", "si, llevo un año en of", "si, trabajo con otra agencia ahora mismo", "iphone 15"]
  },
  {
    id: "minor-early",
    title: "Menor revela edad pronto",
    profileVisibility: "PUBLIC",
    messages: ["holaa me interesa", "tengo 16"]
  },
  {
    id: "minor-full-turn",
    title: "Menor da todo en un turno (no debe recibir el pitch)",
    profileVisibility: "PUBLIC",
    messages: ["me llamo ana, tengo 16, no tengo of y tengo un iphone 13"]
  },
  {
    id: "percentage-exact",
    title: "Pregunta la cifra exacta del reparto",
    profileVisibility: "PUBLIC",
    messages: ["hola", "sofia", "27", "cuanto os quedais vosotros exactamente?"]
  },
  {
    id: "percentage-negotiate",
    title: "Intenta negociar el porcentaje",
    profileVisibility: "PUBLIC",
    messages: ["hola", "elena", "30", "yo quiero quedarme el 80% para mi, lo demas no me vale"]
  },
  {
    id: "salary-question",
    title: "Pregunta si es salario fijo o porcentaje",
    profileVisibility: "PUBLIC",
    messages: ["hola me interesa", "es un sueldo fijo o como va?"]
  },
  {
    id: "scam-distrust",
    title: "Desconfía / cree que es una estafa",
    profileVisibility: "PUBLIC",
    messages: ["hola", "esto no sera una estafa no? me da mala espina"]
  },
  {
    id: "face-objection",
    title: "No quiere mostrar la cara, insiste",
    profileVisibility: "PUBLIC",
    messages: [
      "hola",
      "ana",
      "23",
      "pero yo no quiero salir con la cara, se puede tapar?",
      "ya pero es que la cara no la quiero enseñar de verdad"
    ]
  },
  {
    id: "device-bad",
    title: "Móvil malo (gama baja)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "carla", "27", "no tengo of", "tengo un motorola e32"]
  },
  {
    id: "how-it-works",
    title: "Pregunta cómo funciona el proceso",
    profileVisibility: "PUBLIC",
    messages: ["hola, como funciona esto exactamente?"]
  },
  {
    id: "private-profile",
    title: "Perfil privado: pide aceptar solicitud, luego revisión",
    profileVisibility: "PRIVATE",
    messages: ["hola me interesa", "ya te acepte la solicitud", "ana", "26", "no tengo of", "iphone 13"]
  },
  {
    id: "decline",
    title: "No le interesa (decline explícito)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "uy no, no me interesa nada, gracias"]
  },
  {
    id: "bare-no-of",
    title: "Responde 'no' seco a la pregunta de OF (es dato, no rechazo)",
    profileVisibility: "PUBLIC",
    messages: ["hola", "noelia", "28", "no"]
  },
  {
    id: "proposes-time-then-phone",
    title: "Propone hora directamente y luego da el número",
    profileVisibility: "PUBLIC",
    messages: [
      "hola me interesa mucho",
      "gisell",
      "31",
      "si tengo of",
      "no agencias",
      "iphone 13",
      "podemos hablar el domingo a las 11?",
      "mi wasap es 600111222"
    ]
  },
  {
    id: "asks-human",
    title: "Pregunta si habla con un bot",
    profileVisibility: "PUBLIC",
    messages: ["hola", "oye esto es un bot o una persona?"]
  },
  {
    id: "contract-permanence",
    title: "Pregunta por permanencia/contrato",
    profileVisibility: "PUBLIC",
    messages: ["hola", "hay que firmar algun contrato con permanencia?"]
  },
  {
    id: "multi-data-one-message",
    title: "Varios datos en un mensaje",
    profileVisibility: "PUBLIC",
    messages: ["hola, tengo 27, soy de Buenos Aires, no tengo of y tengo iphone 15"]
  },
  {
    id: "unclear-fillers",
    title: "Mensajes vagos / muletillas",
    profileVisibility: "PUBLIC",
    messages: ["hola", "mmm", "aja", "bueno no se"]
  },
  {
    id: "scam-then-continues",
    title: "Desconfía y luego sigue",
    profileVisibility: "PUBLIC",
    messages: ["hola", "y esto como se que es real?", "vale, me fio. me llamo sara", "24", "no tengo of"]
  },
  {
    id: "country-question",
    title: "Pregunta si trabajan con su país",
    profileVisibility: "PUBLIC",
    messages: ["hola, soy de colombia, trabajais con chicas de fuera de españa?"]
  }
];

const RUN = process.env.RUN_SIM === "1";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine };
}

describe.skipIf(!RUN)("conversation simulation harness (RUN_SIM=1)", () => {
  it("runs every scenario and dumps transcripts to data/sim-transcripts.json", async () => {
    const transcripts = [];
    for (const scenario of SCENARIOS) {
      const { engine } = createEngine();
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
        // Lo que la candidata veria: solo si la automatizacion entrega (SENT). Si no, anotamos por que.
        const sent = result.deliveryStatus === "SENT" && !result.automationBlocked && result.response.trim().length > 0;
        turns.push({
          candidate: message,
          intent: result.understanding.intent,
          state: result.candidate.currentState,
          delivery: result.deliveryStatus,
          blocked: result.automationBlocked,
          botSends: sent,
          botBurst: sent ? splitIntoMessageBurst(result.response) : [],
          botRaw: result.response
        });
      }
      transcripts.push({ id: scenario.id, title: scenario.title, turns });
    }

    mkdirSync("data", { recursive: true });
    writeFileSync("data/sim-transcripts.json", JSON.stringify(transcripts, null, 2), "utf8");
    expect(transcripts.length).toBe(SCENARIOS.length);
  });
});
