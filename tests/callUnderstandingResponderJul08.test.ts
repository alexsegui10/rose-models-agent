import { describe, it, expect } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import { classifyCallSignal } from "@/application/callSignalClassifier";
import { type CallUnderstander, type CallUnderstandRequest, type CallUnderstoodIntent } from "@/application/callUnderstander";
import { businessKnowledgeEntries } from "@/content/business";
import type { BusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";

// Comprensión (LLM) de la llamada: cuando el oído determinista no reconoce una frase REAL, un modelo la
// entiende y la mapea a una intención que NO cambia el estado (responder/tranquilizar/...). Aquí se inyecta
// un entendedor FAKE (determinista) para probar el CABLEADO del responder sin llamar a OpenAI.

class FakeUnderstander implements CallUnderstander {
  readonly calls: CallUnderstandRequest[] = [];
  constructor(private readonly intent: CallUnderstoodIntent | null) {}
  async understand(request: CallUnderstandRequest): Promise<CallUnderstoodIntent | null> {
    this.calls.push(request);
    return this.intent;
  }
}

const OPENING = "Hola Lucia, soy Alex, de Rose Models. Te cuento cómo trabajamos, ¿vale?";

// Frases REALES que el oído determinista NO reconoce (sanity abajo): sirven para forzar el camino de
// comprensión. No llevan interrogación, ni asentimiento, ni términos de dinero/edad.
const UNRECOGNIZED = [
  "mi prima ya hizo algo asi hace tiempo",
  "la vecina me comento una cosa parecida",
  "eso me suena de haberlo visto por ahi"
];

function liveTurn(intent: CallUnderstoodIntent | null, utterance = UNRECOGNIZED[0], retriever?: BusinessKnowledgeRetriever) {
  const messages: CallChatMessage[] = [
    { role: "assistant", content: OPENING },
    { role: "user", content: utterance }
  ];
  return respondToCall({
    messages,
    candidateName: "Lucia",
    understander: new FakeUnderstander(intent),
    retriever
  });
}

describe("comprensión de la llamada: sanity — las frases elegidas son unclear para el oído determinista", () => {
  for (const phrase of UNRECOGNIZED) {
    it(`"${phrase}" -> unclear`, () => {
      expect(classifyCallSignal({ utterance: phrase })).toBe("unclear");
    });
  }
});

describe("comprensión de la llamada: mapea intenciones a directivas que NO cambian el estado", () => {
  it("distrust -> REASSURE (no finge mala línea)", async () => {
    const res = await liveTurn("distrust");
    expect(res.directiveType).toBe("REASSURE");
    expect(res.directiveType).not.toBe("ASK_REPEAT");
  });

  it("earnings -> GIVE_EARNINGS", async () => {
    const res = await liveTurn("earnings");
    expect(res.directiveType).toBe("GIVE_EARNINGS");
  });

  it("identity -> GIVE_IDENTITY", async () => {
    const res = await liveTurn("identity");
    expect(res.directiveType).toBe("GIVE_IDENTITY");
  });

  it("age-policy -> GIVE_AGE_POLICY", async () => {
    const res = await liveTurn("age-policy");
    expect(res.directiveType).toBe("GIVE_AGE_POLICY");
  });

  it("face-concern -> reconduce la cara de forma DETERMINISTA (no finge mala línea; el LLM no redacta la cara)", async () => {
    const res = await liveTurn("face-concern", "es que me da corte todo esto la verdad");
    // Defensa en profundidad (invariante DURO): la comprensión de una duda de cara va a RECONDUCT_FACE
    // (texto fijo aprobado), NO a un turno redactado por el LLM. El texto tranquiliza (corte/imprescindible).
    expect(res.directiveType).toBe("RECONDUCT_FACE");
    expect(res.content.toLowerCase()).toContain("corte");
    expect(res.content.toLowerCase()).toContain("imprescindible");
  });

  it("question cubierta por el conocimiento -> ANSWER_FROM_KNOWLEDGE", async () => {
    const coveringEntry = businessKnowledgeEntries.find(
      (e) => e.id !== "call-details-after-review" && e.id !== "call-post-summary" && e.status === "ACTIVE"
    );
    const retriever: BusinessKnowledgeRetriever = { retrieve: async () => (coveringEntry ? [coveringEntry] : []) };
    const res = await liveTurn("question", UNRECOGNIZED[0], retriever);
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
  });

  it("question NO cubierta -> DEFER_TO_PARTNER (te lo confirmo por WhatsApp)", async () => {
    const retriever: BusinessKnowledgeRetriever = { retrieve: async () => [] };
    const res = await liveTurn("question", UNRECOGNIZED[0], retriever);
    expect(res.directiveType).toBe("DEFER_TO_PARTNER");
  });

  it("none (el modelo no lo entiende) -> ASK_REPEAT (fallback determinista)", async () => {
    const res = await liveTurn("none");
    expect(res.directiveType).toBe("ASK_REPEAT");
  });
});

describe("comprensión de la llamada: SEGURIDAD y fallback", () => {
  it("no se llama al entendedor con RUIDO (solo puntuación) -> ASK_REPEAT sin gastar LLM", async () => {
    const understander = new FakeUnderstander("distrust");
    const res = await respondToCall({
      messages: [
        { role: "assistant", content: OPENING },
        { role: "user", content: "..." }
      ],
      candidateName: "Lucia",
      understander
    });
    expect(understander.calls).toHaveLength(0);
    expect(res.directiveType).toBe("ASK_REPEAT");
  });

  it("sin entendedor (comportamiento de siempre): una frase no reconocida -> ASK_REPEAT", async () => {
    const previous = process.env.CALL_LLM_UNDERSTANDING;
    process.env.CALL_LLM_UNDERSTANDING = "off"; // fuerza que el default del entorno sea undefined
    try {
      const res = await respondToCall({
        messages: [
          { role: "assistant", content: OPENING },
          { role: "user", content: UNRECOGNIZED[0] }
        ],
        candidateName: "Lucia"
      });
      expect(res.directiveType).toBe("ASK_REPEAT");
    } finally {
      if (previous === undefined) delete process.env.CALL_LLM_UNDERSTANDING;
      else process.env.CALL_LLM_UNDERSTANDING = previous;
    }
  });
});

describe("comprensión de la llamada: replay-safe (sin handoff fantasma por 'audio roto')", () => {
  // 3 frases REALES seguidas que el oído no reconoce, cada una en su turno (con el bot hablando entre medias
  // para que NO se fundan). El 4º turno es el que se responde EN VIVO.
  function threeUnrecognizedThenLive(): CallChatMessage[] {
    return [
      { role: "assistant", content: OPENING },
      { role: "user", content: UNRECOGNIZED[0] },
      { role: "assistant", content: "Ya, te entiendo. Sigo entonces." },
      { role: "user", content: UNRECOGNIZED[1] },
      { role: "assistant", content: "Claro, sin problema." },
      { role: "user", content: UNRECOGNIZED[2] },
      { role: "assistant", content: "Perfecto." },
      { role: "user", content: "y otra cosa que se me paso preguntarte antes" } // turno EN VIVO
    ];
  }

  it("CON comprensión: 3 frases reales no reconocidas NO disparan handoff (se entienden, no es audio roto)", async () => {
    const res = await respondToCall({
      messages: threeUnrecognizedThenLive(),
      candidateName: "Lucia",
      understander: new FakeUnderstander("distrust")
    });
    expect(res.directiveType).not.toBe("HANDOFF_TO_ALEX");
  });

  it("SIN comprensión (modo determinista): las mismas 3 frases SÍ acaban en handoff por audio roto", async () => {
    const previous = process.env.CALL_LLM_UNDERSTANDING;
    process.env.CALL_LLM_UNDERSTANDING = "off";
    try {
      const res = await respondToCall({
        messages: threeUnrecognizedThenLive(),
        candidateName: "Lucia"
      });
      expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
    } finally {
      if (previous === undefined) delete process.env.CALL_LLM_UNDERSTANDING;
      else process.env.CALL_LLM_UNDERSTANDING = previous;
    }
  });

  it("audio REALMENTE roto (fragmentos sin vocales) SÍ escala a persona AUNQUE haya comprensión (riesgo revisor)", async () => {
    const understander = new FakeUnderstander("distrust"); // presente, pero no debe llamarse con audio roto
    const res = await respondToCall({
      messages: [
        { role: "assistant", content: OPENING },
        { role: "user", content: "krzt mmm" },
        { role: "assistant", content: "¿Perdona?" },
        { role: "user", content: "sht brr" },
        { role: "assistant", content: "¿Me lo repites?" },
        { role: "user", content: "zzz kkk" } // 3er audio ininteligible EN VIVO -> handoff por audio roto
      ],
      candidateName: "Lucia",
      understander
    });
    expect(res.directiveType).toBe("HANDOFF_TO_ALEX");
    expect(understander.calls).toHaveLength(0); // el audio roto NO se manda a comprensión (no es lenguaje)
  });
});
