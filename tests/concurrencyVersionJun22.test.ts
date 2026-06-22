import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// P1-4 (auditoria de produccion, requisito antes de AUTOMATIC): cuando dos turnos llegan a la vez (webhook +
// reintento de Meta / flush), no deben DUPLICAR respuesta ni pisarse el estado. El bump ATOMICO de la version
// da a cada turno una version distinta; el send-gate deja pasar solo al mas nuevo y DESCARTA al obsoleto SIN
// pausar (pausar dejaria muda a la candidata). El bloqueo por control manual sigue pausando (sin regresion).

async function seed(repository: InMemoryCandidateRepository, state: CandidateState, overrides: Record<string, unknown> = {}) {
  return repository.saveCandidate(
    normalizeCandidate({
      ...createCandidate({ instagramUsername: `conc_${Math.random()}`, profileVisibility: "PUBLIC" }),
      age: 25,
      isAdultConfirmed: true,
      currentState: state,
      ...overrides
    })
  );
}

describe("P1-4: bump atomico de version + send-gate sin doble envio en concurrencia", () => {
  it("bumpGenerationVersion es atomico: devuelve valores crecientes distintos y persiste el ultimo", async () => {
    const repository = new InMemoryCandidateRepository();
    const c = await seed(repository, "QUALIFYING");
    const base = c.generationCancellationVersion;

    const v1 = await repository.bumpGenerationVersion(c.id);
    const v2 = await repository.bumpGenerationVersion(c.id);

    expect(v1).toBe(base + 1);
    expect(v2).toBe(base + 2);
    const reloaded = await repository.findCandidateById(c.id);
    expect(reloaded?.generationCancellationVersion).toBe(base + 2);
  });

  it("turno OBSOLETO por version (otro turno mas nuevo bumpeo) -> BLOCKED y NO pausa (evita doble envio)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({
      repository,
      understandingProvider: new DeterministicUnderstandingProvider(),
      // Simula que un turno concurrente MAS NUEVO bumpeo la version justo antes de que este envie.
      beforeSendCheck: async (candidate) => {
        await repository.bumpGenerationVersion(candidate.id);
        return candidate;
      }
    });
    const c = await seed(repository, "QUALIFYING");

    const result = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "tengo un iphone 15" }]
    });

    expect(result.automationBlocked).toBe(true);
    expect(result.deliveryStatus).toBe("BLOCKED");
    // Clave: el turno obsoleto NO pausa a la candidata (lo gestiona el turno nuevo).
    expect(result.candidate.automationPaused).toBe(false);
  });

  it("bloqueo por CONTROL MANUAL sigue pausando (sin regresion)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    const c = await seed(repository, "QUALIFYING", { manualControlActive: true, automationPaused: true });

    const result = await engine.handleIncomingTurn({
      instagramUsername: c.instagramUsername,
      messages: [{ content: "hola" }]
    });

    expect(result.automationBlocked).toBe(true);
    expect(result.candidate.automationPaused).toBe(true);
  });
});
