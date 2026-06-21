import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider(),
    businessKnowledgeRetriever: new LocalBusinessKnowledgeRetriever(),
    exampleRetriever: new LocalExampleRetriever()
  });
  return { engine, repository };
}

// recordWhatsAppInbound: GUARDA los mensajes entrantes de WhatsApp SIN responder (el bot no auto-responde
// por WhatsApp). Candidata identificada por clave wa:<digitos>, separada de Instagram. Idempotente por wamid.
describe("recordWhatsAppInbound: bandeja de WhatsApp (guardar sin responder)", () => {
  it("crea la candidata wa:<digitos> con el numero y guarda el mensaje, sin cambiar de estado", async () => {
    const { engine, repository } = createEngine();
    const { candidate, stored } = await engine.recordWhatsAppInbound({
      phone: "+34 699 111 222",
      messages: [{ content: "Hola, me interesa", externalMessageId: "wamid.1" }]
    });
    expect(candidate.instagramUsername).toBe("wa:34699111222");
    expect(candidate.phone).toBe("34699111222");
    expect(stored).toBe(1);
    // No corre el bot ni avanza el funnel: queda como lead nuevo (lo que ponga createCandidate).
    expect(candidate.currentState).toBe("NEW_LEAD");

    const messages = await repository.listMessages(candidate.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hola, me interesa");
    expect(messages[0].role).toBe("candidate");
    expect(messages[0].author).toBe("CANDIDATE");
  });

  it("es idempotente por externalMessageId (no duplica el mismo mensaje)", async () => {
    const { engine, repository } = createEngine();
    await engine.recordWhatsAppInbound({ phone: "34699111222", messages: [{ content: "hola", externalMessageId: "wamid.A" }] });
    await engine.recordWhatsAppInbound({ phone: "34699111222", messages: [{ content: "hola", externalMessageId: "wamid.A" }] });
    const candidate = await repository.findCandidateByInstagram("wa:34699111222");
    const messages = await repository.listMessages(candidate!.id);
    expect(messages).toHaveLength(1);
  });

  it("reutiliza la misma candidata para mensajes siguientes del mismo numero", async () => {
    const { engine, repository } = createEngine();
    const first = await engine.recordWhatsAppInbound({
      phone: "34699111222",
      messages: [{ content: "uno", externalMessageId: "wamid.1" }]
    });
    const second = await engine.recordWhatsAppInbound({
      phone: "34699111222",
      messages: [{ content: "dos", externalMessageId: "wamid.2" }]
    });
    expect(second.candidate.id).toBe(first.candidate.id);
    const messages = await repository.listMessages(first.candidate.id);
    expect(messages).toHaveLength(2);
  });

  it("ignora mensajes vacios", async () => {
    const { engine } = createEngine();
    const { stored } = await engine.recordWhatsAppInbound({ phone: "34699111222", messages: [{ content: "   " }] });
    expect(stored).toBe(0);
  });
});
