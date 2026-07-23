import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { StoredCallTurnSignal } from "@/application/callTurnMemory";
import type { CallUnderstander, CallUnderstoodIntent } from "@/application/callUnderstander";
import type { BusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { businessKnowledgeEntries } from "@/content/business";

// FASE 2 — COMPRENSIÓN-PRIMERO (Alex 23-jul, pilares: contexto/coherencia/natural): la IA re-examina
// también los turnos BLANDOS (avance/acuse/desconfianza) para cazar la pregunta u objeción escondida que el
// oído aplanó. GATEADO A MEMORIA (sin memoria = comportamiento clásico, cero divergencia de replay).
// Seguridad/negocio (menor, %, cara, hostil, cierres) NUNCA consultan a la IA: el código corta antes.

const sys: CallChatMessage = { role: "system", content: "p" };
const OPENER = "Hola, soy Alex de Rose Models, ¿te pillo bien? Te cuento cómo trabajamos, ¿vale?";

const memory = () => ({ records: [] as StoredCallTurnSignal[], save: async () => {} });

function understanderSpy(intent: CallUnderstoodIntent | null) {
  const calls: string[] = [];
  const understander: CallUnderstander = {
    understand: async (req) => {
      calls.push(req.utterance);
      return intent;
    }
  };
  return { understander, calls };
}

// Retriever fake: "cubre" siempre con una ficha real ACTIVA (la del pago-primero-a-ella si existe; si no,
// cualquiera activa de contenido). Así el test no depende de los patrones del retriever real.
const coveredEntry = businessKnowledgeEntries.find((e) => e.id === "content-time-commitment") ?? businessKnowledgeEntries[0];
const coveringRetriever: BusinessKnowledgeRetriever = { retrieve: async () => [coveredEntry] };
const emptyRetriever: BusinessKnowledgeRetriever = { retrieve: async () => [] };

describe("Fase 2 — comprensión-primero en señales blandas (gateada a memoria)", () => {
  it("DESCONFIANZA que esconde una PREGUNTA cubierta -> se RESPONDE (no reassure genérico evasivo)", async () => {
    const { understander } = understanderSpy("question");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "ya, pero eso del pago no me fío mucho de cómo va" }
      ],
      understander,
      retriever: coveringRetriever,
      turnMemory: memory()
    });
    expect(res.directiveType).toBe("ANSWER_FROM_KNOWLEDGE");
  });

  it("SIN memoria el mismo turno va al clásico (REASSURE): el gate funciona", async () => {
    const { understander } = understanderSpy("question");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "ya, pero eso del pago no me fío mucho de cómo va" }
      ],
      understander,
      retriever: coveringRetriever
    });
    expect(res.directiveType).toBe("REASSURE");
  });

  it("pregunta escondida SIN cobertura -> se queda la señal del oído (JAMÁS degradar un avance a defer)", async () => {
    const { understander } = understanderSpy("question");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "bueno mirá dale, seguí contando vos lo tuyo" }
      ],
      understander,
      retriever: emptyRetriever,
      turnMemory: memory()
    });
    expect(res.directiveType).toBe("COVER_STAGE"); // avanza; nada de "te lo confirmo por WhatsApp"
  });

  it("el 'smalltalk' de la IA NO pisa un avance del oído (pilar sin-bucles: el guion progresa)", async () => {
    const { understander, calls } = understanderSpy("smalltalk");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "bueno mirá dale, seguí contando vos lo tuyo" }
      ],
      understander,
      retriever: emptyRetriever,
      turnMemory: memory()
    });
    expect(calls.length).toBe(1); // la IA SÍ se consultó...
    expect(res.directiveType).toBe("COVER_STAGE"); // ...pero el avance se mantiene
  });

  it("SEGURIDAD corta antes: una queja del reparto NUNCA consulta a la IA", async () => {
    const { understander, calls } = understanderSpy("question");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "yo quiero mitad y mitad, eh" }
      ],
      understander,
      retriever: coveringRetriever,
      turnMemory: memory()
    });
    expect(calls).toEqual([]); // ni una llamada a la comprensión
    expect(res.directiveType).toBe("COVER_STAGE"); // presenta MONEY (negociación determinista de siempre)
  });

  it("un ACK trivial ('sí, dale') no gasta comprensión (eficiencia) y avanza", async () => {
    const { understander, calls } = understanderSpy("question");
    const res = await respondToCall({
      messages: [...[sys, { role: "assistant", content: OPENER } as CallChatMessage], { role: "user", content: "sí, dale" }],
      understander,
      retriever: coveringRetriever,
      turnMemory: memory()
    });
    expect(calls).toEqual([]);
    expect(res.directiveType).toBe("COVER_STAGE");
  });

  it("miedo de la CARA escondido -> reconducción DETERMINISTA (la IA no redacta sobre la cara)", async () => {
    const { understander } = understanderSpy("face-concern");
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "bueno dale... aunque no sé, me da cosita eso de salir yo" }
      ],
      understander,
      retriever: emptyRetriever,
      turnMemory: memory()
    });
    expect(res.directiveType).toBe("RECONDUCT_FACE");
  });

  it("tema FISCAL no se re-examina (deferencia deliberada intacta)", async () => {
    const { understander, calls } = understanderSpy("question");
    await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "bueno dale, y lo de los impuestos ya me contarás" }
      ],
      understander,
      retriever: coveringRetriever,
      turnMemory: memory()
    });
    expect(calls).toEqual([]); // el guard fiscal evita el re-examen
  });
});
