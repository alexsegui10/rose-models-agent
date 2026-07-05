import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// ITEM 4 de Alex (5-jul): al pausar por el móvil, el bot debe avisar UNA vez y luego CALLARSE (Alex toma
// el relevo). Antes enviaba dos mensajes de rechazo ("Lamentablemente..." y "Como te decía...") y parecía
// que seguía insistiendo. El primer aviso sigue saliendo (no dejarla en visto); el resto -> silencio.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    automationMode: "AUTOMATIC"
  });
  return { engine, repository };
}

async function toDevicePause(engine: ConversationEngine) {
  const opener = await engine.handleIncomingMessage({
    instagramUsername: "and",
    profileVisibility: "PUBLIC",
    message: "hola info"
  });
  const id = opener.candidate.id;
  await engine.handleIncomingMessage({
    candidateId: id,
    instagramUsername: "and",
    profileVisibility: "PUBLIC",
    message: "Andrea"
  });
  await engine.handleIncomingMessage({ candidateId: id, instagramUsername: "and", profileVisibility: "PUBLIC", message: "36" });
  const paused = await engine.handleIncomingMessage({
    candidateId: id,
    instagramUsername: "and",
    profileVisibility: "PUBLIC",
    message: "Samsung A14"
  });
  return { id, paused };
}

describe("móvil no elegible: el bot avisa UNA vez y luego se calla (item 4 de Alex)", () => {
  it("el PRIMER aviso del móvil SÍ se entrega (no la deja en visto)", async () => {
    const { engine } = createEngine();
    const { paused } = await toDevicePause(engine);
    expect(paused.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    expect(paused.deliveryStatus).toBe("SENT");
    expect(paused.response.toLowerCase()).toContain("lamentablemente con ese movil");
  });

  it("los mensajes SIGUIENTES en la pausa por móvil NO se envían (silencio, Alex toma el relevo)", async () => {
    const { engine, repository } = createEngine();
    const { id } = await toDevicePause(engine);
    for (const msg of ["No", "y no hay otra forma?", "bueno gracias", "hola?"]) {
      const r = await engine.handleIncomingMessage({
        candidateId: id,
        instagramUsername: "and",
        profileVisibility: "PUBLIC",
        message: msg
      });
      expect(r.deliveryStatus, `msg "${msg}" deberia quedar BLOQUEADO`).not.toBe("SENT");
      expect(r.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
    }
    // Solo se entregó UN aviso de rechazo del móvil en toda la pausa (el "Como te decía..." repetido
    // ya no se envía). No se cuenta la pregunta "¿qué móvil tienes?" del guion, solo el rechazo.
    const messages = await repository.listMessages(id);
    const rejectionMsgs = messages.filter(
      (m) => m.role === "agent" && m.content.toLowerCase().includes("lamentablemente con ese movil")
    );
    expect(rejectionMsgs.length).toBe(1);
    // Y jamás se persistió el "Como te decía..." repetido.
    const repeatMsgs = messages.filter((m) => m.role === "agent" && m.content.toLowerCase().includes("como te decia"));
    expect(repeatMsgs.length).toBe(0);
  });
});
