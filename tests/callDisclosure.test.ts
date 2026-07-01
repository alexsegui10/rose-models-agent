import { describe, expect, it } from "vitest";
import { callOpeningDisclosure } from "@/application/callDisclosure";

describe("locución de apertura de la llamada", () => {
  // DECISIÓN DE ALEX (jun-2026): la apertura NO declara que es una IA ni ofrece pasar con una persona.
  // Se presenta como "Alex de Rose Models" y solo mantiene el aviso de grabación.
  it("se presenta como Alex de Rose Models (sin declararse IA)", () => {
    const text = callOpeningDisclosure().toLowerCase();
    expect(text).toContain("soy alex");
    expect(text).toContain("rose models");
    expect(text).not.toContain("asistente");
  });

  it("avisa de la grabación por defecto y la omite si recorded=false", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("grabo la llamada");
    expect(callOpeningDisclosure({ recorded: false }).toLowerCase()).not.toContain("grab");
  });

  it("invita a explicar cómo trabajan", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("cómo trabajamos");
  });

  it("personaliza con el nombre si se conoce", () => {
    expect(callOpeningDisclosure({ candidateName: "Lucía" })).toContain("Hola Lucía");
    expect(callOpeningDisclosure()).toContain("Hola,");
  });
});
