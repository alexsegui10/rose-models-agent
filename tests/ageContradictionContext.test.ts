import { describe, expect, it } from "vitest";
import { buildConsistentCandidatePatch } from "@/application/dataConsistency";
import { createCandidate } from "@/domain/candidate";

// Rank 13: un cambio de edad sin correccion explicita SIEMPRE es contradiccion dura (invariante 2), pero
// el motivo se enriquece para que Alex priorice el caso de maximo riesgo (cruce del limite 18).
describe("Contexto de contradiccion de edad cerca del limite 18", () => {
  function ageChange(oldAge: number, newAge: number): string[] {
    const candidate = { ...createCandidate({ instagramUsername: "age_ctx" }), age: oldAge };
    const result = buildConsistentCandidatePatch({
      candidate,
      extractedData: { age: newAge },
      // Sin palabra de correccion -> es contradiccion, no correccion.
      inboundMessage: `ahora digo ${newAge}`
    });
    return result.contradictions;
  }

  it("cruce del limite 18 (17 -> 19) se marca como posible menor mal declarada", () => {
    const [reason] = ageChange(17, 19);
    expect(reason).toContain("age changed from 17 to 19");
    expect(reason).toContain("possible minor misreporting");
  });

  it("ambas menores (15 -> 16) se marca como contradiccion de menor", () => {
    const [reason] = ageChange(15, 16);
    expect(reason).toContain("both minor");
  });

  it("ahora declara ser menor (20 -> 17) se marca explicitamente", () => {
    const [reason] = ageChange(20, 17);
    expect(reason).toContain("now reports being a minor");
  });

  it("cambio entre dos edades adultas sigue siendo contradiccion pero sin etiqueta de menor", () => {
    const [reason] = ageChange(25, 22);
    expect(reason).toContain("age changed from 25 to 22");
    expect(reason).not.toContain("minor");
  });
});
