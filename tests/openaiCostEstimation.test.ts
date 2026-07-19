import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "@/application/openaiProvider";

describe("estimateCostUsd", () => {
  it("usa las tarifas oficiales de gpt-5.4-mini ($0.75 input / $4.50 output por millon)", () => {
    expect(estimateCostUsd("gpt-5.4-mini", 1_000_000, 1_000_000)).toBeCloseTo(5.25, 6);
    expect(estimateCostUsd("gpt-5.4-mini", 2000, 150)).toBeCloseTo(0.002175, 8);
  });

  it("usa las tarifas oficiales de gpt-5.4-nano ($0.20 input / $1.25 output por millon)", () => {
    expect(estimateCostUsd("gpt-5.4-nano", 1_000_000, 1_000_000)).toBeCloseTo(1.45, 6);
    expect(estimateCostUsd("gpt-5.4-nano", 2000, 150)).toBeCloseTo(0.0005875, 9);
  });

  it("mantiene las tarifas de gpt-4.1-mini para trazas legacy", () => {
    expect(estimateCostUsd("gpt-4.1-mini", 1_000_000, 1_000_000)).toBeCloseTo(2.0, 6);
  });

  it("gpt-5.6-terra/sol/luna cobran como gpt-5.4 completo (redaccion de texto desde 18-jul)", () => {
    for (const model of ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"]) {
      expect(estimateCostUsd(model, 1_000_000, 1_000_000), model).toBeCloseTo(17.5, 6);
    }
  });

  it("devuelve null para modelos desconocidos en vez de inventarse un coste", () => {
    expect(estimateCostUsd("modelo-inventado", 1000, 1000)).toBeNull();
  });

  it("devuelve null si faltan los tokens", () => {
    expect(estimateCostUsd("gpt-5.4-mini", null, 100)).toBeNull();
    expect(estimateCostUsd("gpt-5.4-mini", 100, null)).toBeNull();
  });
});
