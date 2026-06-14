import { describe, expect, it } from "vitest";
import { buildUnderstandingInstructions } from "@/application/openaiProvider";

// El prompt de comprension es la palanca primaria contra el sobre-escalado medido con LLM real: el
// modelo marcaba revision humana / inventaba dataContradictions y re-extraia datos benignos en cada
// turno de cualificacion. Estas regresiones fijan la guia que reduce el ruido en el origen.

describe("buildUnderstandingInstructions (guia anti sobre-escalado en modo OpenAI)", () => {
  const instructions = buildUnderstandingInstructions().toLowerCase();

  it("instructs NOT to flag human review for routine qualification data", () => {
    expect(instructions).toContain("nunca marques requireshumanreview");
    // Cubre la cualificacion rutinaria explicita (nombre, edad adulta, of si/no, movil, pais, etc.).
    expect(instructions).toMatch(/dar el nombre|edad adulta/);
    expect(instructions).toMatch(/onlyfans|of si\/no|movil/);
  });

  it("restricts requiresHumanReview to genuine cases (negotiation, minor, scam, injection, legal)", () => {
    expect(instructions).toMatch(/negociacion de una cifra|cifra o porcentaje/);
    expect(instructions).toMatch(/menor|coaccion/);
    expect(instructions).toMatch(/estafa|fraude|enfado/);
    expect(instructions).toMatch(/inyeccion/);
  });

  it("forbids inventing dataContradictions for benign conversational mismatches", () => {
    expect(instructions).toContain("datacontradictions");
    expect(instructions).toMatch(/nunca pongas algo en datacontradictions/);
    // Solo un cambio real de un hecho duro ya dado cuenta como contradiccion.
    expect(instructions).toMatch(/cambia un hecho duro|hecho duro que ya habia dado/);
  });

  it("tells the model to extract only new data in the correct slot and use null for empty fields", () => {
    expect(instructions).toMatch(/datos nuevos/);
    expect(instructions).toMatch(/devuelve null|usa null/);
    // No volcar la descripcion de OF en deviceModel, ni marcadores ':' en campos vacios.
    expect(instructions).toContain("devicemodel");
  });

  // FIX 2: una pregunta generica de proceso/como-funciona/seleccion no debe etiquetarse como
  // ASKS_ABOUT_CONTRACT (eso disparaba la escalada HIR sobre una pregunta que tiene respuesta activa).
  it("tells the model a generic process/how-it-works question is NOT a contract question", () => {
    expect(instructions).toMatch(/proceso|como funciona|seleccion/);
    expect(instructions).toContain("asks_about_contract");
    expect(instructions).toMatch(/permanencia|clausula|exclusividad|terminos legales/);
  });
});
