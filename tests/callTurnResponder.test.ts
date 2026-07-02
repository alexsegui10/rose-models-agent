import { afterEach, describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { BusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import type { KnowledgeEntry } from "@/domain/businessKnowledge";

const sys: CallChatMessage = { role: "system", content: "prompt del agente" };

function mockEntry(points: string[]): KnowledgeEntry {
  return {
    id: "mock",
    category: "FAQ",
    title: "mock",
    facts: [],
    approvedAnswerPoints: points,
    prohibitedClaims: [],
    mandatoryNuances: [],
    escalationConditions: [],
    allowedStates: [],
    tags: [],
    requiresHumanReview: false,
    version: "1",
    status: "ACTIVE",
    approvedByAlex: true,
    updatedAt: "2026-06-17"
  };
}

/** Recuperador que SIEMPRE encuentra una entrada (para probar el camino de responder). */
const stubRetriever: BusinessKnowledgeRetriever = {
  retrieve: async () => [mockEntry(["El cobro se liquida cada 14 días y tú cobras primero."])]
};

afterEach(() => {
  delete process.env.CALL_DISCLOSURE;
});

describe("responder de turno de llamada (stateless por replay)", () => {
  it("sin turnos de la candidata: abre con la locución de apertura (saluda como Alex)", async () => {
    const res = await respondToCall({ messages: [sys] });
    expect(res.directiveType).toBe("GIVE_DISCLOSURE");
    expect(res.content.toLowerCase()).toContain("rose models");
  });

  it("con CALL_DISCLOSURE=off, la apertura legal se omite (modo prueba) y abre con la primera etapa", async () => {
    process.env.CALL_DISCLOSURE = "off";
    const res = await respondToCall({ messages: [sys] });
    expect(res.directiveType).toBe("COVER_STAGE");
    expect(res.content.toLowerCase()).not.toContain("grabo");
  });

  it("tras la apertura, un 'vale' avanza a la primera etapa", async () => {
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "vale, cuéntame" }]
    });
    expect(res.directiveType).toBe("COVER_STAGE");
  });

  it("reproduce el estado: varios 'vale' acaban cerrando con el contrato", async () => {
    // Se avanza turno a turno hasta que aparezca el cierre (robusto a la longitud de la agenda; tras el
    // cierre repetido vendría el silencio anti-loro, cubierto en callAntiLoopJul02).
    const messages: CallChatMessage[] = [sys, { role: "assistant", content: "apertura..." }];
    let closeContent = "";
    for (let i = 0; i < 10 && !closeContent; i++) {
      messages.push({ role: "user", content: "vale" });
      const res = await respondToCall({ messages: [...messages] });
      if (res.directiveType === "CLOSE_WITH_CONTRACT") closeContent = res.content;
      messages.push({ role: "assistant", content: res.content || "..." });
    }
    expect(closeContent.toLowerCase()).toContain("contrato");
  });

  it("una pregunta NO cubierta (impuestos) se defiere a Alex (no improvisa)", async () => {
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "¿y los impuestos?" }]
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
    expect(res.content).toContain("socio");
  });

  it("una pregunta CUBIERTA por el conocimiento se responde (decisión de Alex)", async () => {
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "¿cuándo cobro?" }],
      retriever: stubRetriever
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
    expect(res.content).toContain("14 días");
  });

  it("con answerFromKnowledge=false, defiere TODAS las preguntas (modo conservador)", async () => {
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "¿cuándo cobro?" }],
      retriever: stubRetriever,
      answerFromKnowledge: false
    });
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
  });

  it("integración (recuperador REAL): una pregunta de servicios cubierta se responde, no defiere", async () => {
    // Verifica que la decisión 4 NO está inerte: con el recuperador de verdad (ignoreStateGating), una
    // pregunta cubierta por el conocimiento aprobado se responde en vez de deferir.
    const res = await respondToCall({
      messages: [
        sys,
        { role: "assistant", content: "apertura..." },
        { role: "user", content: "¿qué servicios ofrecéis exactamente?" }
      ]
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
  });

  it("pedir hablar con una persona se mantiene en handoff aunque siga hablando", async () => {
    const messages: CallChatMessage[] = [
      sys,
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "quiero hablar con una persona" },
      { role: "assistant", content: "te paso con mi socio..." },
      { role: "user", content: "vale gracias" }
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
  });

  it("el contenido nunca está vacío (el bot nunca se queda mudo)", async () => {
    const res = await respondToCall({ messages: [sys, { role: "user", content: "ajksdhf qwe" }] });
    expect(res.content.trim().length).toBeGreaterThan(0);
  });

  it("si la candidata habla PRIMERO (el bot aún no habló), abre con la locución de apertura", async () => {
    const res = await respondToCall({ messages: [sys, { role: "user", content: "hola buenas" }] });
    expect(res.directiveType).toBe("GIVE_DISCLOSURE");
    expect(res.content.toLowerCase()).toContain("rose models");
  });

  it("negociación reconstruida por replay: presenta 70 -> defiende -> baja a 65", async () => {
    const messages: CallChatMessage[] = [
      sys,
      { role: "assistant", content: "apertura..." },
      { role: "user", content: "el 30% es mucho" }, // presenta 70/30 (cubre MONEY)
      { role: "assistant", content: "te cuento el reparto..." },
      { role: "user", content: "sigue siendo mucho" }, // defiende el 70 una vez
      { role: "assistant", content: "el 70 es para ti..." },
      { role: "user", content: "bajadlo, no me compensa" } // queja de seguimiento -> baja a 65
    ];
    const res = await respondToCall({ messages });
    expect(res.directiveType).toBe("CONCEDE_SHARE");
    expect(res.content).toContain("65");
  });

  it("con un redactor (LLM) válido, una etapa explicativa usa SU texto natural", async () => {
    const drafter = { draft: async () => "Básicamente nosotros lo hacemos todo y tú solo mandas el contenido, ¿vale?" };
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "vale, cuéntame" }],
      drafter
    });
    expect(res.directiveType).toBe("COVER_STAGE");
    expect(res.content).toContain("nosotros lo hacemos todo");
  });

  it("si el redactor se sale (porcentaje no autorizado), se descarta y cae al guion determinista", async () => {
    const drafter = { draft: async () => "Te doy un 90% para ti, ¿qué tal?" };
    const res = await respondToCall({
      messages: [sys, { role: "assistant", content: "apertura..." }, { role: "user", content: "vale, cuéntame" }],
      drafter
    });
    expect(res.content).not.toContain("90");
    expect(res.content.toLowerCase()).toContain("nos ocupamos nosotros"); // el guion determinista
  });

  it("lo crítico (apertura) NUNCA pasa por el redactor", async () => {
    const drafter = { draft: async () => "TEXTO INVENTADO POR EL LLM" };
    const res = await respondToCall({ messages: [sys], drafter });
    expect(res.directiveType).toBe("GIVE_DISCLOSURE");
    expect(res.content.toLowerCase()).toContain("rose models");
    expect(res.content).not.toContain("INVENTADO");
  });
});
