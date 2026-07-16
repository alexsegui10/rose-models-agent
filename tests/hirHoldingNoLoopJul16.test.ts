import { describe, expect, it } from "vitest";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate, type Candidate, type CandidateState } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresión (auditoría E2E 16-jul): en HIR, ante acuses ("dale", "ok"), el bot repetía el holding del socio
// ("lo hablo con mi socio" / "sigue pendiente con mi socio") turno tras turno = disco rayado. Debe avisar un
// par de veces y luego quedarse en VISTO (ella ya está en HIR, Alex la atiende), como la pausa/el móvil.

function createEngine() {
  const repository = new InMemoryCandidateRepository();
  const engine = new ConversationEngine({
    repository,
    understandingProvider: new DeterministicUnderstandingProvider()
  });
  return { engine, repository };
}

const HOLDING = /lo hablo con mi socio|sigue pendiente con mi socio/i;

describe("no repetir el holding de HIR en bucle (auditoría 16-jul)", () => {
  it("tras un par de holdings, los acuses en HIR quedan en visto (no repite 'lo hablo con mi socio')", async () => {
    const { engine, repository } = createEngine();
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "hir_hold", profileVisibility: "PUBLIC" }),
        firstName: "Romi",
        age: 29,
        isAdultConfirmed: true,
        currentState: "HUMAN_INTERVENTION_REQUIRED" as CandidateState,
        humanReviewReason: "PERCENTAGE_NEGOTIATION"
      } as Candidate)
    );

    const responses: string[] = [];
    for (const msg of ["dale", "ok", "bueno", "dale", "si"]) {
      const r = await engine.handleIncomingMessage({ candidateId: seeded.id, instagramUsername: "hir_hold", message: msg });
      responses.push(r.response.trim());
    }

    // Como mucho 2 holdings; a partir del 3er acuse, visto.
    const holdings = responses.filter((r) => HOLDING.test(r)).length;
    expect(holdings, `holdings emitidos: ${holdings} (${JSON.stringify(responses)})`).toBeLessThanOrEqual(2);
    // Los últimos acuses quedan en visto.
    expect(responses[3]).toBe("");
    expect(responses[4]).toBe("");
  });
});
