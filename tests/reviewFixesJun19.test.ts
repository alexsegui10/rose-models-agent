import { describe, expect, it } from "vitest";
import { extractDeterministicUnderstanding } from "@/application/dataExtractor";
import { parseProposedCallTime } from "@/application/callScheduling";
import { ConversationEngine } from "@/application/conversationEngine";
import { DeterministicUnderstandingProvider } from "@/application/dataExtractor";
import { createCandidate, normalizeCandidate } from "@/domain/candidate";
import { InMemoryCandidateRepository } from "@/infrastructure/repositories/inMemoryCandidateRepository";

// Regresiones de la revisión exhaustiva del 19-jun.
describe("revisión 19-jun: extracción de edad y sí/no", () => {
  // Invariante 2 (falso positivo): un contable tras "N" no es la edad; no debe cerrar a una adulta como menor.
  it.each(["no tengo 15 reels todavia", "uff no tengo 18 tatuajes", "tengo 12 publicaciones nada mas", "tengo 16 pedidos"])(
    "no lee como edad un contable: %s",
    (msg) => {
      const out = extractDeterministicUnderstanding(msg);
      expect(out.extractedData.age).toBeUndefined();
    }
  );

  it("una edad real SÍ se sigue leyendo: 'tengo 34 años'", () => {
    const out = extractDeterministicUnderstanding("tengo 34 años");
    expect(out.extractedData.age).toBe(34);
  });

  it("'claro que no, nunca tuve' a la pregunta de OF => hasOnlyFans=false (no SÍ)", () => {
    const out = extractDeterministicUnderstanding("claro que no, nunca tuve", {
      lastAgentMessage: "me puedes contar si has tenido of alguna vez?"
    });
    expect(out.extractedData.hasOnlyFans).toBe(false);
  });

  it("'claro que si tengo' a la pregunta de OF => hasOnlyFans=true", () => {
    const out = extractDeterministicUnderstanding("claro que si tengo una", {
      lastAgentMessage: "tienes of?"
    });
    expect(out.extractedData.hasOnlyFans).toBe(true);
  });

  it("'pues no, nunca' a la pregunta de agencias => worksWithAnotherAgency=false", () => {
    const out = extractDeterministicUnderstanding("pues no, nunca", {
      lastAgentMessage: "has trabajado alguna vez con otras agencias?"
    });
    expect(out.extractedData.worksWithAnotherAgency).toBe(false);
  });
});

describe("revisión 19-jun: agendado de hora", () => {
  // now = un dia de junio (verano ES) a las 20:00 Argentina (23:00 UTC).
  const now = new Date(Date.UTC(2026, 5, 23, 23, 0));

  it("'12 de la noche' es medianoche (00:00 AR -> 05:00 ES en verano), no mediodia", () => {
    const r = parseProposedCallTime("manana a las 12 de la noche", now);
    expect(r).not.toBeNull();
    expect(r!.labelEs).toContain("05:00");
  });

  it("una hora ya pasada hoy NO se agenda (devuelve null para que el bot repregunte)", () => {
    // "hoy a las 8" cuando en Argentina ya son las 20:00 -> pasado.
    expect(parseProposedCallTime("hoy a las 8 de la manana", now)).toBeNull();
  });
});

describe("revisión 19-jun: invariante 4 (DECLINES no saca de HIR)", () => {
  it("un DECLINES desde HUMAN_INTERVENTION_REQUIRED NO cierra (solo Alex decide)", async () => {
    const repository = new InMemoryCandidateRepository();
    const engine = new ConversationEngine({ repository, understandingProvider: new DeterministicUnderstandingProvider() });
    const seeded = await repository.saveCandidate(
      normalizeCandidate({
        ...createCandidate({ instagramUsername: "hir_decline", profileVisibility: "PUBLIC" }),
        firstName: "Ana",
        age: 28,
        isAdultConfirmed: true,
        currentState: "HUMAN_INTERVENTION_REQUIRED"
      })
    );
    const reply = await engine.handleIncomingMessage({
      candidateId: seeded.id,
      instagramUsername: seeded.instagramUsername,
      message: "no me interesa, dejalo"
    });
    expect(reply.candidate.currentState).not.toBe("CLOSED");
    expect(reply.candidate.currentState).toBe("HUMAN_INTERVENTION_REQUIRED");
  });
});
