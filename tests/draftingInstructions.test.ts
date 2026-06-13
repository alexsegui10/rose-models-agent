import { describe, expect, it } from "vitest";
import { buildDraftingInstructions } from "@/application/openaiProvider";

// El drafting prompt es la unica palanca de voz/flujo en modo OpenAI. Estas regresiones cubren los
// fallos de los jueces que NO son deterministas (los inventaba el modelo redactor): la plantilla de
// rechazo de nombre, el reset de funnel tras el telefono, el pitch diferido al socio, las rafagas
// demasiado largas y la presion sobre un cierre educado.

describe("buildDraftingInstructions (reglas de voz y flujo en modo OpenAI)", () => {
  const instructions = buildDraftingInstructions().toLowerCase();

  it("forbids fabricating a name-refusal template (replay-11 T2 / replay-12 T2)", () => {
    // El modelo emitia 'Si no quieres darme el nombre, dime solo si te interesa...' sobre respuestas
    // neutras. La regla: si el nombre esta en STRUCTURED_MEMORY no se pide, y nunca se acusa a la
    // candidata de no querer darlo.
    expect(instructions).toMatch(/no.*acuses|nunca.*acus|no inventes.*rechazo|no.*dar.*nombre/);
    expect(instructions).toContain("nombre");
  });

  it("forbids restarting the funnel after the phone is provided (replay-14 T9 / replay-15 T12)", () => {
    expect(instructions).toMatch(/no reinici\w*|no vuelvas a empezar|no reabras|nunca reinici/);
  });

  it("keeps the one-idea-per-message burst length (voz: rafagas cortas, no parrafos)", () => {
    expect(instructions).toMatch(/una idea por (mensaje|linea)|2-4 lineas|rafagas/);
  });

  it("backs off a polite soft close instead of pushing the call (replay-11 T16)", () => {
    expect(instructions).toMatch(/tomate el tiempo|no presiones|no insistas|cierre educado|se lo piensa|pensarselo/);
  });

  it("still bans inventing percentages, salaries and launch timelines (invariantes intactos)", () => {
    expect(instructions).toMatch(/no inventes/);
    expect(instructions).toMatch(/porcentaje/);
  });
});
