import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { respondToCall, type CallChatMessage } from "@/application/callTurnResponder";
import type { CallUnderstander } from "@/application/callUnderstander";

// Barrido de voz 20-jul (#2 replay-safety, P1): un HANDOFF real por audio ininteligible se OLVIDABA al turno
// siguiente. La reproducción reiniciaba la racha de `unclear` para TODO turno inteligible-no-entendido (con
// understander presente), asumiendo que la comprensión lo mapeó; pero si en vivo la comprensión devolvió null,
// la racha SÍ subió (y pudo llegar al handoff). Ahora la reproducción mira el transcript: si el bot respondió
// pidiendo repetir / pasando la llamada, NO reinicia -> el handoff se reconstruye (invariante 4).

const ASK_REPEAT = "Perdona, no te he pillado bien con la línea. ¿Me lo puedes repetir?";
const HANDOFF = "Que sí, de verdad: ya le he avisado y en un ratito se pone él en contacto contigo, tranquila.";
// Handoff redactado por LLM con OTRO fraseo (sin "en contacto contigo"): el revisor avisó de que HANDOFF no
// es determinista, así que la firma debe cubrir el abanico que empuja el brief ("te llama / te paso con socio").
const HANDOFF_LLM = "Mira, Laura, esto lo ves mucho mejor con mi socio; le digo que te llame y te lo explica todo.";
const NORMAL = "Nosotros nos encargamos del tráfico y la gestión, tú solo mandas el contenido, ¿vale?";

// Understander fake: presente (activa la reconciliación) pero irrelevante en la reproducción (no se le llama).
const understander: CallUnderstander = { understand: async () => ({ kind: "none" }) as never };

function convo(t3BotResponse: string): CallChatMessage[] {
  return [
    { role: "system", content: "prompt del agente" },
    { role: "assistant", content: "Hola, soy Alex de Rose Models, ¿te pillo bien?" },
    { role: "user", content: "sshh brrr" }, // T1 ininteligible -> unclearStreak 1
    { role: "assistant", content: ASK_REPEAT },
    { role: "user", content: "psst tsss" }, // T2 ininteligible -> unclearStreak 2
    { role: "assistant", content: ASK_REPEAT },
    { role: "user", content: "la ventana morada corre lejos" }, // T3 inteligible pero NO entendido (unclear)
    { role: "assistant", content: t3BotResponse }, // <- lo que el bot respondió EN VIVO a T3
    { role: "user", content: "..." } // T4 ruido
  ];
}

describe("#2 replay-safety: el handoff por audio ininteligible NO se olvida", () => {
  beforeAll(() => {
    process.env.CALL_DISCLOSURE = "off"; // test: disclosureGiven=true (mid-call), no toca el flujo de disclosure real
  });
  afterAll(() => {
    delete process.env.CALL_DISCLOSURE;
  });

  it("si el bot HIZO handoff en T3 (transcript), el replay lo reconstruye -> T4 ruido = STAY_SILENT", async () => {
    const res = await respondToCall({ messages: convo(HANDOFF), understander });
    expect(res.directiveType).toBe("STAY_SILENT");
    expect(res.content).toBe("");
  });

  it("handoff redactado por LLM con OTRO fraseo (sin 'en contacto contigo') también se reconstruye", async () => {
    const res = await respondToCall({ messages: convo(HANDOFF_LLM), understander });
    expect(res.directiveType).toBe("STAY_SILENT");
    expect(res.content).toBe("");
  });

  it("CONTROL: si en T3 el bot RESPONDIÓ normal (la comprensión lo mapeó), NO hay handoff fantasma en T4", async () => {
    const res = await respondToCall({ messages: convo(NORMAL), understander });
    expect(res.directiveType).not.toBe("STAY_SILENT");
    expect(res.content.length).toBeGreaterThan(0);
  });
});
