import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Barrido nocturno 18-jul (panel de 15 jueces): 3 raices de los 2 ERRORES_GRAVES restantes.
// 1. "¿de cuanto seria el porcentaje?" (Ale, x6) no casaba el detector de cifra -> jamas recibio el 70/30.
// 2. La re-pregunta en PAUSA drenaba fichas ajenas (identidad espanola/Pinterest) lote a lote.
// 3. "entre a una agencia (y me metieron en stripchat)" no rellenaba el slot de agencias -> re-pregunta
//    y "disculpame pero ya te dije" (Daiana).

function mk() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

async function toSocioPause(engine: ConversationEngine, u: string) {
  await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo ana" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "tengo 31" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
  await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no nunca he tenido of" }] });
  const socio = await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok gracias" }] });
  expect(socio.response.toLowerCase()).toContain("mi socio");
}

describe("1. '¿de cuanto seria el porcentaje?' recibe la cifra (caso Ale x6, modo de fallo Mayra)", () => {
  it("en pausa, la pregunta de la cifra con ese fraseo responde 70/30 a la PRIMERA", async () => {
    const { engine } = mk();
    const u = "cifra_fraseo_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "ok, y de cuanto seria el porcentaje?" }]
    });
    expect(r.response).toMatch(/70/);
  });

  it("y re-preguntarla la sigue respondiendo (la cifra esta exenta del filtro)", async () => {
    const { engine } = mk();
    const u = "cifra_repite_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok, y de cuanto seria el porcentaje?" }] });
    const again = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "ya, pero de cuanto seria el porcentaje posta?" }]
    });
    expect(again.response).toMatch(/70/);
  });
});

describe("2. la re-pregunta en pausa NO drena fichas ajenas", () => {
  it("repetir una pregunta ya respondida vuelve al visto en vez de soltar el siguiente lote de conocimiento", async () => {
    const { engine } = mk();
    const u = "pausa_drena_" + Math.random().toString().slice(2, 6);
    await toSocioPause(engine, u);
    const first = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "y de la edicion de los videos quien se encarga?" }]
    });
    expect(first.response.trim().length).toBeGreaterThan(0);
    const repeat = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "vale pero de la edicion de los videos quien se encarga?" }]
    });
    // Ni repite lo dicho ni suelta fichas de otros temas (identidad/Pinterest/lanzamiento): visto.
    expect(repeat.response.trim()).toBe("");
  });
});

describe("4. cara: la PREOCUPACION ('me da cosa que me reconozcan') jamas cierra el lead (caso Priscila)", () => {
  it("tras dos reconducciones de cara, expresar miedo a que la reconozcan NO cierra: recibe la reconduccion de privacidad", async () => {
    const { engine } = mk();
    const u = "cara_preoc_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo priscila" }] });
    await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "tengo que mostrar la cara si o si? me preocupa" }]
    });
    await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "pero imprescindible tipo no hay chance de taparla nada?" }]
    });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [
        { content: "no, nunca trabaje con agencias. pero si me ve alguien me reconoce por la cara, no? eso es lo q me da cosa" }
      ]
    });
    expect(r.candidate.currentState).not.toBe("CLOSED");
    expect(r.response.toLowerCase()).not.toContain("no podemos seguir contigo");
  });

  it("la NEGATIVA explicita ('no quiero mostrar la cara, me niego') si sigue cerrando tras reconducir", async () => {
    const { engine } = mk();
    const u = "cara_niega_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo eva" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no quiero mostrar la cara" }] });
    const r = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "que no, que me niego a mostrar la cara, no pienso ensenarla" }]
    });
    expect(r.candidate.currentState).toBe("CLOSED");
  });
});

describe("3. 'entre a una agencia y me metieron en stripchat' rellena el slot de agencias (Daiana: 'ya te dije')", () => {
  it("la historia con 'entre/estuve/me metieron' captura worksWithAnotherAgency y no se re-pregunta", async () => {
    const provider = new DeterministicUnderstandingProvider();
    for (const msg of [
      "hace 3 meses habia entrado a una agencia q decia only y me mandaron a stripchat, lo deje",
      "estuve en una agencia hace poco pero nada q ver",
      "me metieron en una agencia rara y me fui"
    ]) {
      const u = await provider.understand({ inboundMessage: msg, recentMessages: [] } as never);
      expect((u.extractedData as { worksWithAnotherAgency?: boolean }).worksWithAnotherAgency, msg).toBe(true);
    }
  });

  it("el futuro/deseo y la agencia NUESTRA no cuentan; la negacion sigue ganando", async () => {
    const provider = new DeterministicUnderstandingProvider();
    for (const msg of [
      "me gustaria entrar a una agencia como la vuestra",
      "quiero entrar a tu agencia",
      "no entre a ninguna agencia al final"
    ]) {
      const u = await provider.understand({ inboundMessage: msg, recentMessages: [] } as never);
      expect((u.extractedData as { worksWithAnotherAgency?: boolean }).worksWithAnotherAgency, msg).not.toBe(true);
    }
  });

  it("'estuve PENSANDO/mirando en una agencia' es CONSIDERACION, no militancia pasada (riesgo del revisor)", async () => {
    const provider = new DeterministicUnderstandingProvider();
    for (const msg of [
      "estuve pensando en una agencia pero no me decidi",
      "estuve mirando una agencia hace nada",
      "estuve viendo una agencia pero nada"
    ]) {
      const u = await provider.understand({ inboundMessage: msg, recentMessages: [] } as never);
      expect((u.extractedData as { worksWithAnotherAgency?: boolean }).worksWithAnotherAgency, msg).not.toBe(true);
    }
  });

  it("la agencia ENTRECOMILLADA tambien cuenta (barrido terra: Daiana escribio una 'agencia')", async () => {
    const provider = new DeterministicUnderstandingProvider();
    for (const msg of [
      'ya estuve con una "agencia" q me vendio onlyfans y me mandaron a stripchat',
      "entre a una 'agencia' rara y me fui"
    ]) {
      const u = await provider.understand({ inboundMessage: msg, recentMessages: [] } as never);
      expect((u.extractedData as { worksWithAnotherAgency?: boolean }).worksWithAnotherAgency, msg).toBe(true);
    }
  });
});

describe("6. el acuse de edad no se repite si YA se dijo (barrido terra: doble '34 perfecto')", () => {
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "edad_doble" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);

  function planWithAge(recentAgentMessages: string[]) {
    const understanding = ModelConversationOutputSchema.parse({
      intent: "OTHER",
      extractedData: { age: 34 },
      confidence: 0.9,
      suggestedStateTransition: null,
      requiresHumanReview: false,
      humanReviewReason: null,
      response: ""
    });
    return buildResponsePlan({
      candidate,
      understanding,
      inboundMessage: "tengo un samsung",
      knowledgeEntries: [],
      hasApprovedNegotiationDecision: false,
      recentAgentMessages,
      isOpenerTurn: false
    });
  }

  it("si un mensaje reciente ya dijo '34 perfecto, por la edad', NO se re-inyecta el acuse de edad", () => {
    const plan = planWithAge(["34 perfecto, por la edad sin problema", "Y que movil tienes?"]);
    expect(plan.acknowledgedFacts.join(" ")).not.toMatch(/acaba de decir su edad/);
  });

  it("si NO se ha reconocido antes, el acuse de edad si se inyecta (no se pierde)", () => {
    const plan = planWithAge(["Y que movil tienes?"]);
    expect(plan.acknowledgedFacts.join(" ")).toMatch(/acaba de decir su edad/);
  });
});
