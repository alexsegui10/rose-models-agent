import { describe, expect, it } from "vitest";
import { buildConsistentCandidatePatch } from "@/application/dataConsistency";
import { createCandidate, normalizeCandidate, type Candidate } from "@/domain/candidate";

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return normalizeCandidate({ ...createCandidate({ instagramUsername: "17841400000000000" }), ...overrides });
}

// Regresion (bug real visto en produccion): la candidata escribio "sii carlo ya esta" (queria decir
// "si claro ya esta") y OpenAI extrajo nombre="Carlo"/"Claro", que se guardo y el bot empezo a llamarla
// asi. El nombre del LLM debe pasar por los MISMOS guardas que el extractor determinista.
describe("guarda del nombre extraido (dataConsistency)", () => {
  it("NO fija el nombre si es un filler/saludo ('Claro') aunque haya contexto", () => {
    const result = buildConsistentCandidatePatch({
      candidate: candidate(),
      extractedData: { firstName: "Claro" },
      inboundMessage: "me llamo claro",
      lastAgentMessage: "como te llamas?"
    });
    expect(result.patch.firstName).toBeUndefined();
  });

  it("NO fija el nombre si el mensaje no da ningun nombre ('carlo' en 'sii carlo ya esta')", () => {
    const result = buildConsistentCandidatePatch({
      candidate: candidate(),
      extractedData: { firstName: "Carlo" },
      inboundMessage: "sii carlo ya esta",
      lastAgentMessage: "nos puedes aceptar la solicitud de seguimiento?"
    });
    expect(result.patch.firstName).toBeUndefined();
  });

  it("SI fija el nombre cuando la candidata lo dice ('soy Laura')", () => {
    const result = buildConsistentCandidatePatch({
      candidate: candidate(),
      extractedData: { firstName: "Laura" },
      inboundMessage: "hola soy laura, me interesa",
      lastAgentMessage: "buenas, en que puedo ayudarte?"
    });
    expect(result.patch.firstName).toBe("Laura");
  });

  it("SI fija el nombre cuando responde tras preguntarselo (nombre pelado)", () => {
    const result = buildConsistentCandidatePatch({
      candidate: candidate(),
      extractedData: { firstName: "Noelia" },
      inboundMessage: "Noelia",
      lastAgentMessage: "y como te llamas?"
    });
    expect(result.patch.firstName).toBe("Noelia");
  });
});
