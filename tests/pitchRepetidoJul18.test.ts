import { describe, expect, it } from "vitest";
import { ConversationEngine, withoutVerbatimRepetition } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { buildResponsePlan } from "@/application/responsePlanner";
import { ModelConversationOutputSchema, type ConversationUnderstandingInput } from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// LOTE T2a (18-jul): el PITCH REPETIDO de las conversaciones reales (Ale/Alejandra) y el disco rayado
// en la espera de HIR (Daiana). Reproducido en el barrido simulado con gpt-5.4:
//  - "como trabajan?" recuperaba la ficha del porque-70 y contestaba "Porque Rose Models..." (non sequitur)
//  - el pitch canonico resucitaba tras un "👍" aunque su contenido YA se habia dado como respuestas
//  - en HIR, la misma ficha se re-emitia turno tras turno hasta acabar en "Te lo vuelvo a decir: vale pues..."

function createEngine(understandingProvider = new DeterministicUnderstandingProvider()) {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({ repository, understandingProvider });
  return { engine, repository };
}

describe("relevancia: 'como trabajan?' responde el pitch de servicios, no el porque del 70", () => {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "como_trabajan" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);

  it("'como trabajan?' trae services-agency-management y NO commercial-why-agency-70", async () => {
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "como trabajan?",
      ignoreStateGating: true
    });
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("services-agency-management");
    expect(ids).not.toContain("commercial-why-agency-70");
  });

  it("'por que os quedais el 70?' SI trae la ficha del porque-70 (no se pierde)", async () => {
    const entries = await retriever.retrieve({
      candidate,
      intent: "ASKS_ABOUT_PERCENTAGE",
      question: "por que os quedais el 70?",
      ignoreStateGating: true
    });
    expect(entries.map((e) => e.id)).toContain("commercial-why-agency-70");
  });
});

describe("el pitch canonico NO resucita si su nucleo ya se dio como respuesta (caso real Alejandra)", () => {
  it("con 'tu mandas el contenido y nosotros nos encargamos del resto' ya dicho, completar el guion NO re-suelta el pitch", async () => {
    const { engine, repository } = createEngine();
    const username = "ale_pitch_doble";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola, si?"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo ale" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 44" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "nunca tuve of" });
    // La explicacion equivalente al pitch ya salio como RESPUESTA (parafraseo del redactor, caso real):
    await repository.addMessage({
      id: "seed-pitch-parafraseado",
      candidateId: id,
      role: "agent",
      author: "AI_AGENT",
      content:
        "Tu parte seria crear el contenido y enviarnoslo y nosotros nos encargamos del resto.\n\nDe la edicion nos encargamos nosotros.",
      createdAt: new Date()
    });
    // Completa el guion esencial: ANTES aqui saltaba el pitch canonico entero otra vez.
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "tengo un samsung s21"
    });
    expect(result.response.toLowerCase()).not.toMatch(/chatters|cuentas de instagram/);
    expect(result.response.toLowerCase()).not.toContain("te voy a explicar de forma breve");
  });

  it("sin esa explicacion previa, el pitch sigue saliendo al completar el guion (no se pierde el beat)", async () => {
    const { engine } = createEngine();
    const username = "pitch_sigue_vivo";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo eva" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 33" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "no tengo of" });
    const result = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "iphone 14"
    });
    expect(result.response.toLowerCase()).toMatch(/chatters|cuentas de instagram/);
  });
});

// Proveedor fake por la interfaz (regla de tests): fuerza el intent que OpenAI daba en el caso real
// (REQUESTS_INFORMATION para un imperativo sin pregunta), que el determinista no reproduce.
class ForcedInfoIntentProvider extends DeterministicUnderstandingProvider {
  async understand(input: ConversationUnderstandingInput) {
    const understanding = await super.understand(input);
    if (input.inboundMessage.includes("me explicas")) {
      return { ...understanding, intent: "REQUESTS_INFORMATION" as const };
    }
    return understanding;
  }
}

describe("HIR: la misma ficha no se re-emite en la espera (caso real Daiana: 'Te lo vuelvo a decir: vale pues...')", () => {
  async function driveToHir(engine: ConversationEngine, username: string) {
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo dai" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 34" });
    // Negociacion en pleno guion -> HUMAN_INTERVENTION_REQUIRED (invariante 3), antes de la pausa del socio:
    const hir = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "Me dais el 90% y lo hacemos?"
    });
    expect(hir.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    return id;
  }

  it("un imperativo SIN pregunta con intent de info NO re-suelta la ficha ya dicha (ni 'Te lo vuelvo a decir')", async () => {
    const { engine } = createEngine(new ForcedInfoIntentProvider());
    const username = "dai_hir_disco";
    const id = await driveToHir(engine, username);
    // Dos imperativos sin "?" que el modelo etiqueta como peticion de info. La 1ª emision de la ficha
    // se permite (aun no se le habia dicho); la 2ª es el disco rayado de Daiana y debe filtrarse.
    const first = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "dale, me explicas como trabajan y listo"
    });
    expect(first.response.toLowerCase()).toContain("te voy a explicar de forma breve");
    const second = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "dale, me explicas como trabajan y quedo atenta"
    });
    expect(second.response.toLowerCase()).not.toContain("te voy a explicar de forma breve");
    expect(second.response.toLowerCase()).not.toContain("te lo vuelvo a decir");
    expect(second.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("el REDACTOR tampoco ve la ficha SUSTANCIALMENTE ya dicha en un turno HIR sin pregunta (Daiana: transparencia 3 veces)", async () => {
    // Replica el leak del barrido: la desconfianza lleva a HIR, la ficha objection-distrust sale entera,
    // y en el siguiente desahogo SIN pregunta gpt la re-parafraseaba porque la veia en knowledgeEntries.
    const seenEntryIds: string[][] = [];
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      draftingProvider: {
        async draft(input: { knowledgeEntries: Array<{ id: string }> }) {
          seenEntryIds.push(input.knowledgeEntries.map((entry) => entry.id));
          // Borrador vacio -> se entrega la respuesta determinista (los facts del plan) y queda en historial.
          return {
            response: "",
            requestedProvider: "openai",
            actualProvider: "deterministic",
            usedFallback: true
          } as never;
        }
      } as never
    });
    const username = "dai_hir_drafter";
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo dai" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 34" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "iphone 14" });
    // Desconfianza declarada SIN pregunta -> HIR.
    const first = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "la verdad me da mala espina esto, parece estafa"
    });
    expect(first.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    // La emision REAL del caso (turno 18 de Daiana, redactada por gpt con la ficha casi entera) se siembra
    // tal cual quedo en el historial:
    await repository.addMessage({
      id: "seed-transparencia-dicha",
      candidateId: id,
      role: "agent",
      author: "AI_AGENT",
      content:
        "Nosotros somos totalmente transparentes.\n\nEres tu la que recibes los pagos de la plataforma y despues nos pagas a nosotros, asi que el dinero pasa primero por ti.\n\nPodemos ir paso a paso y sin compromiso.",
      createdAt: new Date()
    });
    const callsBefore = seenEntryIds.filter((ids) => ids.includes("objection-distrust")).length;
    // Segundo desahogo sin pregunta: la ficha SUSTANCIALMENTE dicha (3 de 4 puntos) no debe volver al
    // redactor ni re-emitirse ("sisi eso ya me lo repetiste").
    const second = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "posta me sigue dando mala espina esto eh, la otra vez me pasaron cosas raras"
    });
    expect(second.response.toLowerCase()).not.toContain("dinero pasa primero por ti");
    const callsAfter = seenEntryIds.filter((ids) => ids.includes("objection-distrust")).length;
    expect(callsAfter).toBe(callsBefore);
  });

  it("el NO de MENORES se repite SIEMPRE, aunque ya se dijera (bloqueante del revisor: tag safety exento del filtro)", async () => {
    // Repro del revisor: en HIR, tras recibir el NO rotundo, una afirmacion sin "?" ("estaba pensando en
    // salir con mi hija") NO puede caer al holding del socio (sonaria a que se esta valorando).
    const { engine } = createEngine();
    const username = "dai_hir_menores";
    const id = await driveToHir(engine, username);
    const asked = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "mis hijos salen en las fotos?"
    });
    expect(asked.response.toLowerCase()).toMatch(/jamas|solo tu|nunca/);
    const insist = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "dale, igual estaba pensando en salir con mi hija en alguna foto"
    });
    expect(insist.response.toLowerCase()).toMatch(/jamas|solo tu|nunca/);
    expect(insist.response.toLowerCase()).not.toContain("pendiente con mi socio");
    // "la nena" sin posesivo (sonda del revisor): el retriever ya la surfacea, el gate no debe bloquearla.
    const nena = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "la nena sale conmigo en algun video igual"
    });
    expect(nena.response.toLowerCase()).toMatch(/jamas|solo tu|nunca/);
  });

  it("una PREGUNTA explicita en HIR se sigue respondiendo aunque repita (decision 7-jul: 'como trabajais' nunca se difiere)", async () => {
    const { engine } = createEngine();
    const username = "dai_hir_pregunta";
    const id = await driveToHir(engine, username);
    const asked = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "y como trabajan ustedes?"
    });
    // Con pregunta real, la explicacion sale (repetida o variada), jamas un defer al socio de algo que sabe.
    expect(asked.response.toLowerCase()).toMatch(/contenido|resto|trabajamos/);
    expect(asked.response.toLowerCase()).not.toContain("dejame que lo hable con mi socio");
  });

  it("re-preguntar la CIFRA con '?' en HIR sigue respondiendo el 70/30 (invariante 3 reactivo, caso Mayra)", async () => {
    const { engine } = createEngine();
    const username = "dai_hir_cifra";
    const id = await driveToHir(engine, username);
    const again = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "cual es el porcentaje exacto?"
    });
    expect(again.response).toMatch(/70/);
  });
});

describe("el prefijo de re-explicacion es calido ('Como te decia:'), no 'Te lo vuelvo a decir:'", () => {
  it("la variante re-explicada arranca con 'Como te decia:'", async () => {
    const retriever = new LocalBusinessKnowledgeRetriever();
    const candidate = normalizeCandidate({
      ...createCandidate({ instagramUsername: "prefijo_calido" }),
      firstName: "Dai",
      age: 34,
      isAdultConfirmed: true,
      currentState: "QUALIFYING"
    } as unknown as Candidate);
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "que tipo de contenido debo enviarte?",
      ignoreStateGating: true
    });
    const understanding = ModelConversationOutputSchema.parse({
      intent: "REQUESTS_INFORMATION",
      extractedData: {},
      confidence: 0.9,
      suggestedStateTransition: null,
      requiresHumanReview: false,
      humanReviewReason: null,
      response: ""
    });
    const plan = buildResponsePlan({
      candidate,
      understanding,
      inboundMessage: "que tipo de contenido debo enviarte?",
      knowledgeEntries: entries,
      hasApprovedNegotiationDecision: false,
      recentAgentMessages: [],
      isOpenerTurn: false
    });
    expect(plan.answerFacts.length).toBeGreaterThan(0);
    // 1ª pasada: respuesta repetida -> devuelve la respuesta del plan; 2ª: TAMBIEN repite -> prefijo.
    const planAnswer = withoutVerbatimRepetition("dup", "dup", plan, "QUALIFYING", true);
    const wrapped = withoutVerbatimRepetition(planAnswer, planAnswer, plan, "QUALIFYING", true);
    expect(wrapped).toMatch(/^Como te decia: /);
    expect(wrapped).not.toContain("Te lo vuelvo a decir");
  });
});
