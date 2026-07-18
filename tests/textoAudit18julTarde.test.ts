import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { buildResponsePlan } from "@/application/responsePlanner";
import { validateFactualResponse } from "@/application/factualValidator";
import { ModelConversationOutputSchema } from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

// Barrido 18-jul (tarde), 4 fallos de la simulacion completa de Daiana:
// 1. GRAVE: en HIR el redactor propuso "dime dia y hora", CONFIRMO "mañana a las 17 arg entonces" y pidio
//    el telefono SIN el Encaja (invariante 4: el validador debe tumbar esos fraseos).
// 2. El primer mensaje con historia+pregunta rara saltaba a revision SIN NI SALUDAR (el opener es
//    "siempre, pase lo que pase").
// 3. El relato en PASADO de una agencia que dejo disparaba la ficha multi-agencia ("¿son de trafico
//    espanol las otras agencias?" a alguien sin agencias).
// 4. En HIR, el redactor copiaba burbujas del historial (transparencia x3) e inventaba preguntas
//    ("¿metodo de pago?") que el guion no pide.

function planFor(humanFitDecision: "APPROVED" | undefined) {
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "guard_agenda" }),
    currentState: "HUMAN_INTERVENTION_REQUIRED",
    humanFitDecision
  } as unknown as Candidate);
  const understanding = ModelConversationOutputSchema.parse({
    intent: "OTHER",
    extractedData: {},
    confidence: 0.8,
    suggestedStateTransition: null,
    requiresHumanReview: false,
    humanReviewReason: null,
    response: ""
  });
  return buildResponsePlan({
    candidate,
    understanding,
    inboundMessage: "dale",
    knowledgeEntries: [],
    hasApprovedNegotiationDecision: false,
    recentAgentMessages: [],
    isOpenerTurn: false
  });
}

describe("1. invariante 4: sin Encaja, el validador tumba pedir/confirmar dia y hora (fraseos del barrido)", () => {
  const unauthorized = planFor(undefined);
  const authorized = planFor("APPROVED");

  it("sin Encaja: 'dime dia y hora', la confirmacion 'mañana a las 17 arg entonces' y 'quedamos mañana a las 5' caen", () => {
    for (const text of [
      "La llamada seria normal de telefono.\n\nSi te viene bien, dime dia y hora y lo apunto??",
      "si, mañana a las 17 arg entonces\n\nPasame tu numero de telefono",
      "Perfecto, quedamos mañana a las 5 y te cuento todo."
    ]) {
      expect(validateFactualResponse(text, unauthorized).valid, text).toBe(false);
    }
  });

  it("el holding honesto sigue siendo valido sin Encaja, y con Encaja los fraseos de agenda pasan", () => {
    expect(
      validateFactualResponse(
        "En cuanto lo revise con mi socio te escribo y cuadramos la llamada, no te preocupes.",
        unauthorized
      ).valid
    ).toBe(true);
    expect(validateFactualResponse("Si te viene bien, dime dia y hora y lo apunto??", authorized).valid).toBe(true);
  });
});

describe("2. el opener SIEMPRE saluda, aunque el primer mensaje traiga historia y pregunta sin cobertura", () => {
  function createEngine() {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    return { engine, repository };
  }

  it("primer mensaje tipo Daiana (historia + pregunta rara) -> opener con saludo y nombre, sin saltar a revision", async () => {
    const { engine } = createEngine();
    const r = await engine.handleIncomingMessage({
      instagramUsername: "opener_historia",
      profileVisibility: "PUBLIC",
      message:
        "hola che, m escribieron x lo de la agencia? te cuento, hace 3 meses entre a una q era para only y me metieron en stripchat, lo deje"
    });
    expect(r.response).toContain("soy Alex de Rose Models");
    expect(r.response.toLowerCase()).toContain("como te llamas");
    expect(r.candidate.currentState).not.toBe("HUMAN_INTERVENTION_REQUIRED");
  });

  it("INVARIANTE 2 INTACTO: una menor en el primer mensaje sigue cerrando, sin opener", async () => {
    const { engine } = createEngine();
    const r = await engine.handleIncomingMessage({
      instagramUsername: "opener_menor",
      profileVisibility: "PUBLIC",
      message: "hola! tengo 16 años y quiero info"
    });
    expect(r.candidate.currentState).toBe("CLOSED");
    expect(r.response.toLowerCase()).toContain("mayores de edad");
  });

  it("INVARIANTE 3 INTACTO: negociar en el primer mensaje sigue escalando (el opener cede ante escalada real)", async () => {
    const { engine } = createEngine();
    const r = await engine.handleIncomingMessage({
      instagramUsername: "opener_nego",
      profileVisibility: "PUBLIC",
      message: "Me dais el 90% y lo hacemos?"
    });
    expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});

describe("3. el relato en PASADO de una agencia que dejo NO dispara la ficha multi-agencia", () => {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "multi_pasado" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);

  it("'la otra agencia me chamuyo... lo deje' no trae multi-agencia; 'estoy con otra agencia ahora' si", async () => {
    const past = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question: "la otra agencia me chamuyo con only y me mandaron a stripchat, lo deje ahi nomas",
      ignoreStateGating: true
    });
    expect(past.map((e) => e.id).join(",")).not.toContain("multi-agency");
    const present = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question: "aparte estoy con otra agencia ahora mismo, hay problema?",
      ignoreStateGating: true
    });
    expect(present.some((e) => e.tags.includes("multi-agency"))).toBe(true);
  });
});

describe("5. flecos del barrido final: menores sin ruido, 1ª persona, ruta de transferencia", () => {
  const retriever = new LocalBusinessKnowledgeRetriever();
  const candidate = normalizeCandidate({
    ...createCandidate({ instagramUsername: "flecos_barrido" }),
    currentState: "QUALIFYING"
  } as unknown as Candidate);

  it("una pregunta de CONTENIDO normal ya no arrastra el NO de menores; la pregunta de menores si lo trae", async () => {
    const contentQ = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "que tipo de contenido debo enviarte?",
      ignoreStateGating: true
    });
    expect(contentQ.map((e) => e.id)).not.toContain("content-only-her-no-minors");
    const minorsQ = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "mis hijos salen en las fotos?",
      ignoreStateGating: true
    });
    expect(minorsQ.map((e) => e.id)).toContain("content-only-her-no-minors");
  });

  it("la revision final del perfil se dice en 1ª PERSONA (el bot ES Alex en texto)", async () => {
    const { businessKnowledgeEntries } = await import("@/content/business");
    const entry = businessKnowledgeEntries.find((e) => e.id === "candidate-requirements-target-profile");
    const text = (entry?.approvedAnswerPoints ?? []).join(" ");
    expect(text).toContain("la hago yo");
    expect(text).not.toContain("la hace Alex");
  });

  it("B1 revisor: '¿puedo grabar contenido con mi hija?' SIGUE trayendo el NO de menores (sin el tag content)", async () => {
    for (const q of ["puedo grabar contenido con mi hija?", "hago las fotos con mi nena y listo"]) {
      const entries = await retriever.retrieve({
        candidate,
        intent: "REQUESTS_INFORMATION",
        question: q,
        ignoreStateGating: true
      });
      expect(
        entries.map((e) => e.id),
        q
      ).toContain("content-only-her-no-minors");
    }
  });

  it("R1 revisor: multi-agencia PRESENTE con palabras tipo 'entre ellas' SI dispara; el pasado anclado no", async () => {
    const present = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question: "trabajo con dos agencias, entre ellas una de mexico",
      ignoreStateGating: true
    });
    expect(present.some((e) => e.tags.includes("multi-agency"))).toBe(true);
  });

  it("R3 revisor: el modismo 'eso ya es otra historia' NO suelta la politica de identidad; el fraseo real si", async () => {
    const modismo = await retriever.retrieve({
      candidate,
      intent: "OTHER",
      question: "jaja eso ya es otra historia, pero bueno",
      ignoreStateGating: true
    });
    expect(modismo.map((e) => e.id)).not.toContain("geo-privacy-three-layers");
    const real = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "usarian otra historia con mis fotos?",
      ignoreStateGating: true
    });
    expect(real.map((e) => e.id)).toContain("geo-privacy-three-layers");
  });

  it("R4 revisor: los fraseos de agenda con orden invertido tambien caen sin Encaja", () => {
    const unauthorized = planFor(undefined);
    for (const text of [
      "perfecto, el lunes te llamo",
      "lo dejamos para el viernes a las 5",
      "hablamos mañana a las 17 arg",
      "anotame para mañana y te cuento",
      "mañana a las 17 te va bien?"
    ]) {
      expect(validateFactualResponse(text, unauthorized).valid, text).toBe(false);
    }
    // Sin falsos positivos nuevos: el opener y el holding honesto siguen pasando.
    expect(
      validateFactualResponse(
        "Te hago un par de preguntas rapidas mientras te explico como trabajamos, sin compromiso, y si encaja agendamos una llamada para contartelo con calma.",
        unauthorized
      ).valid
    ).toBe(true);
  });

  it("'esos pagos como los hacen? transferencia o q?' surfacea la ficha de liquidacion (antes: 'Perfecto')", async () => {
    const entries = await retriever.retrieve({
      candidate,
      intent: "REQUESTS_INFORMATION",
      question: "y esos pagos como los hacen? transferencia o q?",
      ignoreStateGating: true
    });
    expect(entries.some((e) => e.tags.includes("settlement") || e.tags.includes("payment"))).toBe(true);
  });
});

describe("4. en HIR: ni copiar burbujas del historial ni preguntas inventadas del redactor", () => {
  // Fuerza el intent que OpenAI daba en el caso real (peticion de info sin "?"): sin el, el plan del turno
  // llega vacio y el redactor ni se llama (regla de tests: proveedor fake por la interfaz).
  class ForcedInfoIntentProvider extends DeterministicUnderstandingProvider {
    async understand(input: Parameters<DeterministicUnderstandingProvider["understand"]>[0]) {
      const understanding = await super.understand(input);
      if (input.inboundMessage.includes("me explicas")) {
        return { ...understanding, intent: "REQUESTS_INFORMATION" as const };
      }
      return understanding;
    }
  }

  // El input del redactor no lleva el mensaje entrante: el fake se activa por la FICHA surfaceada en el
  // turno objetivo (services via "me explicas"), y devuelve vacio (-> determinista) en el resto.
  function engineWithFakeDrafter(cannedForServicesTurn: string) {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new ForcedInfoIntentProvider(),
      draftingProvider: {
        async draft(input: { candidateState: string; knowledgeEntries: Array<{ id: string }> }) {
          if (
            input.candidateState === "HUMAN_INTERVENTION_REQUIRED" &&
            input.knowledgeEntries.some((entry) => entry.id === "services-agency-management")
          ) {
            return {
              response: cannedForServicesTurn,
              requestedProvider: "openai",
              actualProvider: "openai",
              usedFallback: false
            } as never;
          }
          return { response: "", requestedProvider: "openai", actualProvider: "deterministic", usedFallback: true } as never;
        }
      } as never
    });
    return { engine, repository };
  }

  async function driveToHir(engine: ConversationEngine, username: string) {
    const opener = await engine.handleIncomingMessage({
      instagramUsername: username,
      profileVisibility: "PUBLIC",
      message: "hola"
    });
    const id = opener.candidate.id;
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "me llamo dai" });
    await engine.handleIncomingMessage({ candidateId: id, instagramUsername: username, message: "tengo 34" });
    const hir = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      message: "Me dais el 90% y lo hacemos?"
    });
    expect(hir.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    return id;
  }

  it("una burbuja YA DICHA que el redactor copia del historial no se re-envia (transparencia x3 del barrido)", async () => {
    const { engine, repository } = engineWithFakeDrafter(
      "entiendo, es normal que quieras tenerlo claro\n\nEres tu la que recibes los pagos de la plataforma y despues nos pagas a nosotros, asi que el dinero pasa primero por ti."
    );
    const username = "hir_copia";
    const id = await driveToHir(engine, username);
    await repository.addMessage({
      id: "seed-transparencia",
      candidateId: id,
      role: "agent",
      author: "AI_AGENT",
      content:
        "Nosotros somos totalmente transparentes.\n\nEres tu la que recibes los pagos de la plataforma y despues nos pagas a nosotros, asi que el dinero pasa primero por ti.",
      createdAt: new Date()
    });
    const r = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      // "me explicas" surfacea services -> el turno va al redactor fake (que copia del historial).
      message: "dale, me explicas eso bien y quedo atenta"
    });
    expect(r.response.toLowerCase()).not.toContain("dinero pasa primero por ti");
  });

  it("una pregunta INVENTADA por el redactor ('metodo de pago') se recorta; el resto del mensaje se conserva", async () => {
    const { engine } = engineWithFakeDrafter(
      "Entonces la cuenta esta limpia y mejor aun\n\nLa tenias solo creada o tambien llegaste a poner algun metodo de pago y dejarla lista del todo?"
    );
    const username = "hir_inventada";
    const id = await driveToHir(engine, username);
    const r = await engine.handleIncomingMessage({
      candidateId: id,
      instagramUsername: username,
      // "me explicas" surfacea services -> el turno va al redactor fake (que aqui inventa la pregunta).
      message: "dale, me explicas eso bien y quedo atenta"
    });
    expect(r.response).not.toContain("metodo de pago");
    expect(r.response.toLowerCase()).toContain("la cuenta esta limpia");
  });
});
