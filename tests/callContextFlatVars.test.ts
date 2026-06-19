import { describe, expect, it } from "vitest";
import { contextFromFlatVars } from "@/server/callLlmHandler";

// Regresion: el disparador outbound manda el contexto del DM como variables dinamicas PLANAS (snake_case);
// el handler debe reconstruir el contexto para que el bot sepa con quien habla en la llamada.
describe("contextFromFlatVars (contexto plano de la llamada)", () => {
  it("reconstruye el contexto desde variables planas snake_case", () => {
    const context = contextFromFlatVars({
      candidate_id: "abc",
      candidate_name: "Marina",
      age: 27,
      country: "España",
      has_onlyfans: true,
      works_with_another_agency: false,
      scheduled_slot: "el martes a las 18h",
      interest_level: "HIGH",
      dm_summary: "Tiene OF, quiere crecer.",
      concerns: "le da miedo enseñar la cara; ya la estafaron"
    });
    expect(context?.candidateName).toBe("Marina");
    expect(context?.age).toBe(27);
    expect(context?.hasOnlyFans).toBe(true);
    expect(context?.scheduledSlot).toBe("el martes a las 18h");
    expect(context?.dmSummary).toBe("Tiene OF, quiere crecer.");
    expect(context?.concerns).toEqual(["le da miedo enseñar la cara", "ya la estafaron"]);
  });

  it("acepta numeros/booleanos enviados como string (ElevenLabs)", () => {
    const context = contextFromFlatVars({ candidate_name: "Ana", age: "31", has_onlyfans: "false" });
    expect(context?.age).toBe(31);
    expect(context?.hasOnlyFans).toBe(false);
  });

  it("devuelve undefined si no hay ninguna variable de contexto (no fabrica contexto vacio)", () => {
    expect(contextFromFlatVars({})).toBeUndefined();
    expect(contextFromFlatVars({ candidate_id: "solo-id" })).toBeUndefined();
  });
});
