import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { buildDraftPrompt, getCallDrafter, OpenAiCallDrafter } from "@/application/openaiCallDrafter";
import type { CallDraftRequest } from "@/application/callDrafter";

const brief = {
  instruction: "Explica cómo trabaja la agencia.",
  groundingFacts: ["Tú mandas el contenido y nosotros hacemos el resto."],
  prohibitedClaims: ["No prometer ingresos."],
  mandatoryNuances: ["El volumen de contenido es orientativo."],
  referenceInstagram: false
};
const request: CallDraftRequest = { brief, directiveType: "COVER_STAGE" };

describe("redactor OpenAI de voz", () => {
  it("el prompt incluye objetivo, hechos aprobados, prohibiciones y reglas duras en castellano", () => {
    const p = buildDraftPrompt(request);
    expect(p).toContain("Explica cómo trabaja la agencia.");
    expect(p).toContain("Tú mandas el contenido y nosotros hacemos el resto.");
    expect(p).toContain("No prometer ingresos.");
    expect(p.toLowerCase()).toContain("españa");
    expect(p).toContain("REGLAS DURAS");
  });

  it("el prompt incluye el contexto de la candidata si lo hay (sin repreguntar lo ya sabido)", () => {
    const p = buildDraftPrompt({
      brief,
      context: { candidateName: "Marta", concerns: ["desconfianza"] },
      directiveType: "COVER_STAGE"
    });
    expect(p).toContain("Marta");
    expect(p).toContain("desconfianza");
    expect(p.toLowerCase()).toContain("no le repreguntes");
  });

  it("draft devuelve el texto del modelo (cliente fake)", async () => {
    const fake = { responses: { create: async () => ({ output_text: "Pues mira, nosotros lo hacemos todo." }) } };
    const drafter = new OpenAiCallDrafter({ apiKey: "x", model: "m", timeoutMs: 1000 }, fake as unknown as OpenAI);
    expect(await drafter.draft(request)).toContain("nosotros lo hacemos todo");
  });

  it("draft devuelve null si el modelo falla (-> el responder usará el fallback determinista)", async () => {
    const fake = {
      responses: {
        create: async () => {
          throw new Error("boom");
        }
      }
    };
    const drafter = new OpenAiCallDrafter({ apiKey: "x", model: "m", timeoutMs: 1000 }, fake as unknown as OpenAI);
    expect(await drafter.draft(request)).toBeNull();
  });

  it("getCallDrafter: APAGADO por defecto; encendido necesita clave", () => {
    expect(getCallDrafter({} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(getCallDrafter({ CALL_LLM_REDACTION: "on" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    const drafter = getCallDrafter({
      CALL_LLM_REDACTION: "on",
      OPENAI_API_KEY: "sk-test"
    } as unknown as NodeJS.ProcessEnv);
    expect(drafter).toBeDefined();
  });
});
