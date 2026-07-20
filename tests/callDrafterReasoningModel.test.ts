import { describe, expect, it } from "vitest";
import OpenAI from "openai";
import { OpenAiCallDrafter, isReasoningCallModel } from "@/application/openaiCallDrafter";
import type { CallDraftRequest } from "@/application/callDrafter";

// Bench de latencia 20-jul: la voz baja a gpt-5.6-luna (reasoning=low) por API directa (~2x más rápida y
// consistente que gpt-5.4). Los modelos de razonamiento 5.6 RECHAZAN `temperature` (400) y aceptan
// `reasoning.effort`. El redactor debe adaptar la petición según el modelo, SIN romper el clásico (5.4).

function makeRequest(): CallDraftRequest {
  return {
    directiveType: "TEST",
    brief: {
      instruction: "Saluda con naturalidad.",
      groundingFacts: [],
      prohibitedClaims: [],
      mandatoryNuances: [],
      referenceInstagram: false,
      candidateUtterance: "hola",
      callFacts: [],
      coveredTopics: [],
      pendingTopics: []
    } as never
  };
}

interface Captured {
  params?: Record<string, unknown>;
}

function fakeClient(cap: Captured): OpenAI {
  return {
    responses: {
      create: async (params: Record<string, unknown>) => {
        cap.params = params;
        return { output_text: "Hola, soy Alex." };
      }
    }
  } as unknown as OpenAI;
}

describe("isReasoningCallModel: detecta la familia 5.6 (terra/luna) y no el clásico 5.4", () => {
  it("terra/luna y 5.6+ son de razonamiento", () => {
    expect(isReasoningCallModel("gpt-5.6-luna")).toBe(true);
    expect(isReasoningCallModel("gpt-5.6-terra")).toBe(true);
    expect(isReasoningCallModel("gpt-5.6")).toBe(true);
  });
  it("gpt-5.4 y mini NO son de razonamiento (mantienen temperature)", () => {
    expect(isReasoningCallModel("gpt-5.4")).toBe(false);
    expect(isReasoningCallModel("gpt-5.4-mini")).toBe(false);
  });
});

describe("OpenAiCallDrafter adapta la petición al tipo de modelo", () => {
  it("RAZONAMIENTO (gpt-5.6-luna): SIN temperature, CON reasoning.effort, holgura de tokens", async () => {
    const cap: Captured = {};
    const drafter = new OpenAiCallDrafter(
      { apiKey: "k", model: "gpt-5.6-luna", timeoutMs: 3500, reasoningEffort: "low" },
      fakeClient(cap)
    );
    const text = await drafter.draft(makeRequest());
    expect(text).toBe("Hola, soy Alex.");
    expect(cap.params?.model).toBe("gpt-5.6-luna");
    expect(cap.params?.temperature).toBeUndefined();
    expect(cap.params?.reasoning).toEqual({ effort: "low" });
    expect(Number(cap.params?.max_output_tokens)).toBeGreaterThanOrEqual(320);
  });

  it("reasoningEffort por defecto 'low' si no se especifica", async () => {
    const cap: Captured = {};
    const drafter = new OpenAiCallDrafter({ apiKey: "k", model: "gpt-5.6-terra", timeoutMs: 3500 }, fakeClient(cap));
    await drafter.draft(makeRequest());
    expect(cap.params?.reasoning).toEqual({ effort: "low" });
  });

  it("CLÁSICO (gpt-5.4): CON temperature 0.7, SIN reasoning (cero regresión)", async () => {
    const cap: Captured = {};
    const drafter = new OpenAiCallDrafter({ apiKey: "k", model: "gpt-5.4", timeoutMs: 3500 }, fakeClient(cap));
    await drafter.draft(makeRequest());
    expect(cap.params?.temperature).toBe(0.7);
    expect(cap.params?.reasoning).toBeUndefined();
  });
});
