import { describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import {
  prepareCallTurnMemory,
  turnMemoryUtteranceKey,
  type CallTurnMemoryStore,
  type StoredCallTurnSignal
} from "@/application/callTurnMemory";
import type { CallUnderstander } from "@/application/callUnderstander";

// FASE 1 del cambio de estructura (Alex 23-jul): MEMORIA DE LLAMADA. El replay reproduce las señales
// resueltas EN VIVO (incluidas las de la comprensión IA) en vez de re-clasificar a ciegas; con candado de
// frase (solo se aplica si la frase del registro coincide EXACTA con la del transcript en ese índice) y
// paracaídas (sin memoria o con candado fallido -> camino clásico intacto).

const sys: CallChatMessage = { role: "system", content: "p" };
const OPENER = "Hola, soy Alex de Rose Models, ¿te pillo bien? Te cuento cómo trabajamos, ¿vale?";

function mem(records: StoredCallTurnSignal[], saved?: StoredCallTurnSignal[]) {
  return {
    records,
    save: async (r: StoredCallTurnSignal) => {
      saved?.push(r);
    }
  };
}

describe("Fase 1 — memoria de llamada (replay usa señales guardadas)", () => {
  it("la señal RECORDADA manda: un 'not-interested' guardado cierra, aunque el oído clásico avanzaría", async () => {
    // "vale genial" el oído lo lee como avance; la memoria dice que EN VIVO se entendió como not-interested
    // (cierre suave). El replay debe reproducir el cierre -> el turno siguiente de ruido tras terminal calla.
    const res = await respondToCall({
      messages: [
        sys,
        { role: "assistant", content: OPENER },
        { role: "user", content: "vale genial" },
        { role: "assistant", content: "cierre suave..." },
        { role: "user", content: "..." }
      ],
      turnMemory: mem([
        { turnIndex: 0, utterance: turnMemoryUtteranceKey("vale genial"), signal: "not-interested", refinedByUnderstander: true }
      ])
    });
    expect(res.directiveType).toBe("STAY_SILENT");
    expect(res.content).toBe("");
  });

  it("CANDADO de frase: si la frase guardada NO coincide con el transcript, el registro se ignora (camino clásico)", async () => {
    const res = await respondToCall({
      messages: [
        sys,
        { role: "assistant", content: OPENER },
        { role: "user", content: "vale genial" },
        { role: "assistant", content: "sigo con el guion..." },
        { role: "user", content: "dale, sigue" }
      ],
      turnMemory: mem([
        // Registro con OTRA frase (descuadre de índices): jamás debe aplicarse.
        {
          turnIndex: 0,
          utterance: turnMemoryUtteranceKey("no me interesa nada"),
          signal: "not-interested",
          refinedByUnderstander: true
        }
      ])
    });
    // Camino clásico: "vale genial" avanza el guion con normalidad (nada de cierre fantasma).
    expect(res.directiveType).toBe("COVER_STAGE");
    expect(res.content.length).toBeGreaterThan(0);
  });

  it("PERSISTE el turno en vivo con su procedencia: comprensión IA -> refinedByUnderstander=true", async () => {
    const saved: StoredCallTurnSignal[] = [];
    const understander: CallUnderstander = { understand: async () => "smalltalk" };
    const res = await respondToCall({
      messages: [
        ...[sys, { role: "assistant", content: OPENER } as CallChatMessage],
        { role: "user", content: "la ventana morada corre lejos" }
      ],
      understander,
      turnMemory: mem([], saved)
    });
    expect(res.signal).toBe("acknowledge");
    // Espera al fire-and-forget (mismo tick de microtasks).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      turnIndex: 0,
      utterance: turnMemoryUtteranceKey("la ventana morada corre lejos"),
      signal: "acknowledge",
      refinedByUnderstander: true
    });
  });

  it("el flag guardado se REPRODUCE: asks-earnings del oído (flag=false) cubre MONEY; de la IA (flag=true) no", async () => {
    const base: CallChatMessage[] = [
      sys,
      { role: "assistant", content: OPENER },
      { role: "user", content: "y de guita como andamos" },
      { role: "assistant", content: "respuesta de dinero..." },
      { role: "user", content: "¿cuánto os lleváis exactamente?" }
    ];
    const record = (refined: boolean): StoredCallTurnSignal => ({
      turnIndex: 0,
      utterance: turnMemoryUtteranceKey("y de guita como andamos"),
      signal: "asks-earnings",
      refinedByUnderstander: refined
    });
    // flag=false (oído): el replay cubre MONEY en el turno 0 -> la pregunta de la cifra RE-DICE la cifra.
    const oido = await respondToCall({ messages: base, turnMemory: mem([record(false)]) });
    expect(oido.directiveType).toBe("GIVE_SHARE_FIGURE");
    // flag=true (comprensión IA): el turno 0 NO mutó estado -> la pregunta de la cifra PRESENTA el dinero.
    const ia = await respondToCall({ messages: base, turnMemory: mem([record(true)]) });
    expect(ia.directiveType).toBe("COVER_STAGE");
  });

  it("SIN memoria todo sigue igual (paracaídas): mismo transcript, camino clásico", async () => {
    const res = await respondToCall({
      messages: [
        sys,
        { role: "assistant", content: OPENER },
        { role: "user", content: "vale genial" },
        { role: "assistant", content: "sigo..." },
        { role: "user", content: "dale, sigue" }
      ]
    });
    expect(res.directiveType).toBe("COVER_STAGE");
  });
});

// RIESGO 1 del revisor (23-jul): la línea que separa "llamada nueva limpia" de "una señal vieja cierra la
// llamada nueva" debe estar protegida por test. prepareCallTurnMemory es lo que cablea el endpoint.
describe("prepareCallTurnMemory: llamada nueva limpia; llamada en curso carga", () => {
  function fakeStore(records: StoredCallTurnSignal[]) {
    const calls = { cleared: [] as string[], loaded: [] as string[], saved: [] as Array<{ key: string; r: StoredCallTurnSignal }> };
    const store: CallTurnMemoryStore = {
      load: async (key) => {
        calls.loaded.push(key);
        return records;
      },
      save: async (key, r) => {
        calls.saved.push({ key, r });
      },
      clear: async (key) => {
        calls.cleared.push(key);
      }
    };
    return { store, calls };
  }
  const OLD_RECORD: StoredCallTurnSignal = {
    turnIndex: 0,
    utterance: turnMemoryUtteranceKey("si"),
    signal: "not-interested",
    refinedByUnderstander: true
  };

  it("LLAMADA NUEVA (el bot aún no habló): LIMPIA la memoria vieja y arranca con 0 registros", async () => {
    const { store, calls } = fakeStore([OLD_RECORD]);
    const memory = await prepareCallTurnMemory(store, "cand-1", false);
    expect(calls.cleared).toEqual(["cand-1"]); // el clear se llama SIEMPRE en la apertura
    expect(memory.records).toEqual([]); // jamás arranca con señales de otra llamada
    expect(calls.loaded).toEqual([]); // ni siquiera se cargan
  });

  it("llamada EN CURSO: carga los registros y NO limpia", async () => {
    const { store, calls } = fakeStore([OLD_RECORD]);
    const memory = await prepareCallTurnMemory(store, "cand-1", true);
    expect(calls.cleared).toEqual([]);
    expect(memory.records).toEqual([OLD_RECORD]);
  });

  it("el save de la memoria persiste con la clave de la candidata", async () => {
    const { store, calls } = fakeStore([]);
    const memory = await prepareCallTurnMemory(store, "cand-9", true);
    await memory.save?.({ turnIndex: 2, utterance: "hola", signal: "follows-along", refinedByUnderstander: false });
    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0].key).toBe("cand-9");
    expect(calls.saved[0].r.turnIndex).toBe(2);
  });

  it("E2E del caso dañino: el 'not-interested' de una llamada VIEJA no cierra la llamada NUEVA", async () => {
    const { store } = fakeStore([OLD_RECORD]);
    // Apertura de la llamada nueva -> prepare con callAlreadyStarted=false -> memoria vacía.
    const memory = await prepareCallTurnMemory(store, "cand-1", false);
    const res = await respondToCall({
      messages: [
        { role: "system", content: "p" },
        { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" },
        { role: "user", content: "si" },
        { role: "assistant", content: "sigo con el guion..." },
        { role: "user", content: "dale, sigue" }
      ],
      turnMemory: memory
    });
    expect(res.directiveType).toBe("COVER_STAGE"); // avanza con normalidad: NADA de cierre fantasma
  });
});
