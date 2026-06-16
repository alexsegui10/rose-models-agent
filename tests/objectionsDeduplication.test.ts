import { describe, expect, it } from "vitest";
import { buildConsistentCandidatePatch } from "@/application/dataConsistency";
import { createCandidate } from "@/domain/candidate";

describe("objections deduplication", () => {
  it("does not store the same objection twice across messages", () => {
    const candidate = createCandidate({ instagramUsername: "dedup_case" });

    const patch1 = buildConsistentCandidatePatch({
      candidate,
      extractedData: { objections: ["Device not compatible"] },
      inboundMessage: "Mi dispositivo no funciona"
    });
    const candidateAfterPatch1 = {
      ...candidate,
      objections: patch1.patch.objections ?? candidate.objections
    };

    const patch2 = buildConsistentCandidatePatch({
      candidate: candidateAfterPatch1,
      extractedData: { objections: ["Device not compatible"] },
      inboundMessage: "Mi dispositivo sigue sin funcionar"
    });

    // La objecion repetida no debe volver a anadirse: no se emite patch (o queda en 1 ocurrencia).
    const finalObjections = patch2.patch.objections ?? candidateAfterPatch1.objections;
    expect(finalObjections).toEqual(["Device not compatible"]);
  });

  it("dedup is case-insensitive and trims whitespace", () => {
    const candidate = {
      ...createCandidate({ instagramUsername: "dedup_case_ci" }),
      objections: ["No quiero salir con la cara"]
    };

    const patch = buildConsistentCandidatePatch({
      candidate,
      extractedData: { objections: ["  no quiero salir con la cara  "] },
      inboundMessage: "No quiero salir con la cara"
    });

    // Misma objecion con distinto casing/espacios -> no se duplica.
    const finalObjections = patch.patch.objections ?? candidate.objections;
    expect(finalObjections).toEqual(["No quiero salir con la cara"]);
  });

  it("dedup colapsa espacios internos multiples (no acumula la misma objecion mal espaciada)", () => {
    const candidate = {
      ...createCandidate({ instagramUsername: "dedup_inner_spaces" }),
      objections: ["No quiero salir con la cara"]
    };

    const patch = buildConsistentCandidatePatch({
      candidate,
      extractedData: { objections: ["no   quiero  salir con la  cara"] },
      inboundMessage: "No quiero salir con la cara"
    });

    // Misma objecion, solo cambia el espaciado interno -> no se duplica: el conteo de objeciones
    // (p.ej. el de la cara) no debe inflarse por espacios de mas.
    const finalObjections = patch.patch.objections ?? candidate.objections;
    expect(finalObjections).toEqual(["No quiero salir con la cara"]);
  });

  it("still appends genuinely new objections", () => {
    const candidate = {
      ...createCandidate({ instagramUsername: "dedup_case_new" }),
      objections: ["Device not compatible"]
    };

    const patch = buildConsistentCandidatePatch({
      candidate,
      extractedData: { objections: ["No quiere mostrar la cara"] },
      inboundMessage: "No quiero salir con la cara"
    });

    expect(patch.patch.objections).toEqual(["Device not compatible", "No quiere mostrar la cara"]);
  });
});
