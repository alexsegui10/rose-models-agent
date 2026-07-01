import { describe, expect, it } from "vitest";
import { callOpeningDisclosure } from "@/application/callDisclosure";

describe("locución de apertura de la llamada", () => {
  // DECISIÓN DE ALEX (jun-2026): la apertura NO declara que es una IA ni ofrece pasar con una persona.
  // Se presenta como "Alex de Rose Models".
  it("se presenta como Alex de Rose Models (sin declararse IA)", () => {
    const text = callOpeningDisclosure().toLowerCase();
    expect(text).toContain("soy alex");
    expect(text).toContain("rose models");
    expect(text).not.toContain("asistente");
  });

  // DECISIÓN DE ALEX (jul-2026): por defecto NO se anuncia la grabación; solo se dice si recorded=true (opt-in).
  it("por defecto NO avisa de la grabación; solo la anuncia si recorded=true", () => {
    expect(callOpeningDisclosure().toLowerCase()).not.toContain("grab");
    expect(callOpeningDisclosure({ recorded: false }).toLowerCase()).not.toContain("grab");
    expect(callOpeningDisclosure({ recorded: true }).toLowerCase()).toContain("grabo la llamada");
  });

  it("invita a explicar cómo trabajan", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("cómo trabajamos");
  });

  it("personaliza con el nombre si se conoce", () => {
    expect(callOpeningDisclosure({ candidateName: "Lucía" })).toContain("Hola Lucía");
    expect(callOpeningDisclosure()).toContain("Hola,");
  });
});
