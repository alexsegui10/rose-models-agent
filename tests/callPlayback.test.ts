import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { LocalBusinessKnowledgeRetriever } from "@/application/businessKnowledgeRetriever";
import { LocalExampleRetriever } from "@/application/exampleRetriever";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";
import { getConversationAudio } from "@/infrastructure/integrations/elevenLabsConversations";

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

// Reproducir la llamada grabada: el disparador outbound guarda el conversationId de ElevenLabs en la
// candidata (al iniciar la llamada, fuente fiable), y la ficha lo usa para pedir el audio al proxy.
describe("reproduccion de llamadas: persistir conversationId al disparar", () => {
  it("noteCallAttempt guarda lastCallConversationId, incrementa intentos y lo persiste", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({ ...createCandidate({ instagramUsername: "playback_case" }), currentState: "CALL_SCHEDULED" })
    );
    const { candidate } = await engine.noteCallAttempt(seeded.id, "conv_abc123");
    expect(candidate.lastCallConversationId).toBe("conv_abc123");
    expect(candidate.callAttempts).toBe(1);
    const reloaded = await repository.findCandidateById(seeded.id);
    expect(reloaded?.lastCallConversationId).toBe("conv_abc123");
  });

  it("sin conversationId conserva el anterior (no lo borra)", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "playback_case2" }),
        currentState: "CALL_SCHEDULED",
        lastCallConversationId: "conv_old"
      })
    );
    const { candidate } = await engine.noteCallAttempt(seeded.id);
    expect(candidate.lastCallConversationId).toBe("conv_old");
  });
});

describe("proxy de grabacion: cliente getConversationAudio", () => {
  it("llama al endpoint oficial de ElevenLabs con xi-api-key y devuelve el stream", async () => {
    let calledUrl = "";
    let calledKey = "";
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calledUrl = String(url);
      calledKey = String((init?.headers as Record<string, string> | undefined)?.["xi-api-key"] ?? "");
      return new Response("FAKE_MP3", { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as unknown as typeof fetch;

    const res = await getConversationAudio("conv_xyz", "sk-test-key", fakeFetch);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("audio/mpeg");
    expect(calledUrl).toContain("/v1/convai/conversations/conv_xyz/audio");
    expect(calledKey).toBe("sk-test-key");
  });

  it("si la red falla, devuelve ok:false sin lanzar (el proxy responde error limpio)", async () => {
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const res = await getConversationAudio("conv_1", "k", failing);
    expect(res.ok).toBe(false);
    expect(res.body).toBeNull();
  });
});
