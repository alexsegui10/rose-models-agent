import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// P0-3 (auditoria de produccion): si un turno MUERE por timeout (SIGKILL de Vercel Hobby ~10s) tras guardar
// el inbound y antes de responder, el reintento de Meta NO debe tratarse como duplicado y dejar a la
// candidata en silencio para siempre: debe REPROCESAR. Pero un mensaje YA respondido si se ignora (no doble).

function setup() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
  return { engine, repository };
}

async function seed(repository: InMemoryCandidateRepository, state: CandidateState, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `dedup_${Math.random()}`, profileVisibility: "PUBLIC" }),
      age: 25,
      isAdultConfirmed: true,
      currentState: state,
      ...overrides
    })
  );
}

describe("P0-3: dedup por mid solo ignora si YA se respondio (recuperacion de turno muerto)", () => {
  it("reintento de Meta de un mensaje YA respondido -> se ignora como duplicado (no doble respuesta)", async () => {
    const { engine, repository } = setup();
    const c = await seed(repository, "QUALIFYING");

    const first = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo 25 anos y un iphone 15", externalMessageId: "m1" }]
    });
    expect(first.duplicate).toBe(false);
    // El turno respondio (en HUMAN_APPROVAL queda PENDING pero se guarda como mensaje del agente).
    const afterFirst = await repository.listMessages(c.id, 50);
    expect(afterFirst.some((m) => m.role === "agent")).toBe(true);

    const retry = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo 25 anos y un iphone 15", externalMessageId: "m1" }]
    });
    expect(retry.duplicate).toBe(true);
  });

  it("reintento de un mensaje NO respondido (turno murio) -> reprocesa y responde, sin duplicar el inbound", async () => {
    const { engine, repository } = setup();
    const c = await seed(repository, "QUALIFYING");
    // Simula el turno muerto: el inbound quedo guardado pero NO hay respuesta del agente despues.
    await repository.addMessage({
      id: crypto.randomUUID(),
      candidateId: c.id,
      role: "candidate",
      author: "CANDIDATE",
      content: "tengo 25 anos y un iphone 15",
      externalMessageId: "m2",
      createdAt: new Date()
    });

    const retry = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo 25 anos y un iphone 15", externalMessageId: "m2" }]
    });

    expect(retry.duplicate).toBe(false); // NO se ignora: se reprocesa
    expect(retry.response.trim().length).toBeGreaterThan(0); // responde
    // El inbound m2 NO se re-guarda (sigue habiendo UNA sola burbuja con ese mid).
    const msgs = await repository.listMessages(c.id, 50);
    expect(msgs.filter((m) => m.externalMessageId === "m2").length).toBe(1);
  });
});
