import { describe, expect, it } from "vitest";
import { extractCallFacts } from "@/application/callFactExtractor";

// Barrido realista 20-jul (Marta): "yo ni tengo OnlyFans" -> el extractor guardaba el hecho OPUESTO
// ("Ya tiene cuenta de OnlyFans"), porque NO_ONLYFANS solo cazaba "no tengo" y "ni tengo OnlyFans" contiene
// "tengo OnlyFans" (dispara HAS_ONLYFANS) -> luna insistía "ya tienes OnlyFans". Ahora los negados ganan.

describe("estado de OnlyFans: los NEGADOS no se confunden con 'ya tiene' (coherencia 20-jul)", () => {
  it("'ni/no/tampoco tengo OnlyFans' -> Aún NO tiene (nunca 'Ya tiene')", () => {
    for (const u of ["yo ni tengo OnlyFans", "no tengo onlyfans", "tampoco tengo only fans", "no tengo cuenta de OnlyFans"]) {
      const facts = extractCallFacts([u]).join(" ");
      expect(facts, u).toMatch(/Aún no tiene|Aun no tiene/);
      expect(facts, u).not.toMatch(/Ya tiene/);
    }
  });
  it("los POSITIVOS siguen dando 'Ya tiene' (no se rompe el caso normal)", () => {
    expect(extractCallFacts(["ya tengo OnlyFans"]).join(" ")).toContain("Ya tiene cuenta de OnlyFans");
    expect(extractCallFacts(["tengo una cuenta de onlyfans"]).join(" ")).toContain("Ya tiene cuenta de OnlyFans");
    expect(extractCallFacts(["mi onlyfans lo llevo yo"]).join(" ")).toContain("Ya tiene cuenta de OnlyFans");
  });
});
