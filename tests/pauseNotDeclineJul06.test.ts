import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import type { ConversationUnderstandingProvider, ConversationUnderstandingInput } from "@/application/llmProvider";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// P0 real cazado en la simulacion COMPLETA con el modelo (6-jul): la candidata dijo "ok gracias, lo pienso"
// y el modelo lo clasifico como DECLINES; en WAITING_HUMAN_REVIEW eso la CERRABA (lead bueno perdido). Un
// "me lo pienso" es una PAUSA, nunca un rechazo: el codigo corrige al modelo (invariante 1). Este test
// simula el error del modelo (DECLINES ante un mensaje de pausa) y verifica que NO se cierra.

// Proveedor que se comporta como el determinista, salvo que FUERZA DECLINES cuando el mensaje trae "lo pienso"
// (reproduce el fallo real de mini). Asi el guard resolveContextualDecline es lo unico que evita el cierre.
class DeclineOnPauseProvider implements ConversationUnderstandingProvider {
  private base = new DeterministicUnderstandingProvider();
  async understand(input: ConversationUnderstandingInput) {
    const out = await this.base.understand(input);
    if (/lo pienso/i.test(input.inboundMessage)) {
      return { ...out, intent: "DECLINES" as const };
    }
    return out;
  }
}

function mk() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeclineOnPauseProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

describe("'Me lo pienso' es pausa, NUNCA rechazo (P0 sim completa 6-jul)", () => {
  it("en revision humana, un 'ok gracias, lo pienso' NO cierra a la candidata aunque el modelo diga DECLINES", async () => {
    const { engine } = mk();
    const u = "pause_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo sofia" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "31" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "iphone 14" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "no, nunca he tenido" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "ok" }] });

    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "ok gracias, lo pienso" }]
    });

    // Lo critico: NO se cierra. Sigue esperando (la decision es de Alex, no del bot).
    expect(res.candidate.currentState).not.toBe("CLOSED");
  });

  it("un rechazo REAL y explicito ('no me interesa, dejalo') si se respeta (no lo confunde con pausa)", async () => {
    const { engine } = mk();
    const u = "decl_" + Math.random().toString().slice(2, 6);
    await engine.handleIncomingTurn({ instagramUsername: u, profileVisibility: "PUBLIC", messages: [{ content: "hola" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "me llamo sofia" }] });
    await engine.handleIncomingTurn({ instagramUsername: u, messages: [{ content: "31" }] });
    const res = await engine.handleIncomingTurn({
      instagramUsername: u,
      messages: [{ content: "no me interesa, dejalo" }]
    });
    // Un decline real NO se convierte en pausa por este guard (no matchea wantsToPausePattern).
    expect(res.understanding.intent).toBe("DECLINES");
  });
});
