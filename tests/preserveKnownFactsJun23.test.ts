import { describe, expect, it } from "vitest";
import { preserveKnownFacts } from "@/application/conversationEngine";
import { createCandidate, normalizeCandidate, type CandidateState } from "@/domain/candidate";

// CANDADO DEFINITIVO (Alex 23-jun): un dato HARD ya contestado NUNCA se pierde en un turno por una re-inferencia
// del LLM que lo "olvide" (pasaba con el movil y con la edad -> el bot los re-preguntaba). preserveKnownFacts
// compara el candidato AL CARGAR con el actualizado y restaura lo perdido (conocido -> vacio/desconocido). Un
// CAMBIO real (conocido -> otro conocido) NO se toca.

function base(overrides: Record<string, unknown> = {}) {
  return normalizeCandidate({
    ...createCandidate({ instagramUsername: `pk_${Math.random()}`, profileVisibility: "PUBLIC" }),
    currentState: "QUALIFYING" as CandidateState,
    ...overrides
  });
}

describe("preserveKnownFacts: un dato HARD ya contestado nunca se pierde (Alex 23-jun)", () => {
  it("restaura TODOS los datos HARD que el turno haya perdido (olvido del LLM)", () => {
    const previous = base({
      firstName: "Ana",
      age: 40,
      isAdultConfirmed: true,
      deviceType: "IPHONE",
      deviceModel: "iphone 13",
      deviceEligibility: "APPROVED",
      hasOnlyFans: true,
      worksWithAnotherAgency: false,
      phone: "34600000000",
      country: "Espana"
    });
    // El turno "olvido" todo (vacio/UNKNOWN/undefined).
    const updated = normalizeCandidate({
      ...previous,
      firstName: undefined,
      age: undefined,
      isAdultConfirmed: false,
      deviceType: "UNKNOWN",
      deviceModel: null,
      deviceEligibility: "UNKNOWN",
      hasOnlyFans: undefined,
      worksWithAnotherAgency: undefined,
      phone: undefined,
      country: undefined
    });

    const result = preserveKnownFacts(previous, updated);

    expect(result.firstName).toBe("Ana");
    expect(result.age).toBe(40);
    expect(result.isAdultConfirmed).toBe(true);
    expect(result.deviceModel).toBe("iphone 13");
    expect(result.deviceEligibility).toBe("APPROVED");
    expect(result.hasOnlyFans).toBe(true);
    expect(result.worksWithAnotherAgency).toBe(false);
    expect(result.phone).toBe("34600000000");
    expect(result.country).toBe("Espana");
  });

  it("NO bloquea un CAMBIO real: un valor conocido NUEVO se conserva (no se restaura el viejo)", () => {
    const previous = base({ age: 40, deviceModel: "iphone 13", deviceEligibility: "APPROVED" });
    const updated = normalizeCandidate({
      ...previous,
      age: 41,
      deviceModel: "iphone 8",
      deviceEligibility: "NOT_ELIGIBLE"
    });

    const result = preserveKnownFacts(previous, updated);

    expect(result.age).toBe(41);
    expect(result.deviceModel).toBe("iphone 8");
    expect(result.deviceEligibility).toBe("NOT_ELIGIBLE");
  });

  it("INVARIANTE 2: una correccion de edad a MENOR (40 -> 17) PASA; no restaura la vieja ni resucita isAdultConfirmed", () => {
    const previous = base({ age: 40, isAdultConfirmed: true });
    const updated = normalizeCandidate({ ...previous, age: 17, isAdultConfirmed: false });
    const result = preserveKnownFacts(previous, updated);
    expect(result.age).toBe(17);
    expect(result.isAdultConfirmed).toBe(false);
  });

  it("no toca nada si no se perdio ningun dato (no-op)", () => {
    const previous = base({ firstName: "Ana", age: 40, hasOnlyFans: false });
    const updated = normalizeCandidate({ ...previous, city: "Madrid" });
    const result = preserveKnownFacts(previous, updated);
    expect(result.city).toBe("Madrid");
    expect(result.firstName).toBe("Ana");
    expect(result.age).toBe(40);
  });
});
