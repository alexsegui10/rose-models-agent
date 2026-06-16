import { describe, expect, it } from "vitest";
import { callOpeningDisclosure } from "@/application/callDisclosure";

describe("locución de apertura de la llamada", () => {
  it("declara SIEMPRE que es un asistente automatizado (EU AI Act)", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("asistente automatizado");
  });

  it("avisa de la grabación por defecto y la omite si recorded=false", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("se graba");
    expect(callOpeningDisclosure({ recorded: false }).toLowerCase()).not.toContain("se graba");
  });

  it("ofrece hablar con una persona", () => {
    expect(callOpeningDisclosure().toLowerCase()).toContain("una persona");
  });

  it("personaliza con el nombre si se conoce", () => {
    expect(callOpeningDisclosure({ candidateName: "Lucía" })).toContain("Hola Lucía");
    expect(callOpeningDisclosure()).toContain("Hola,");
  });
});
