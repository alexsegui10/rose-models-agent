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

  // DECISIÓN DE ALEX (jul-2026): la redacción natural va ENCENDIDA por defecto cuando hay clave (el
  // validador de voz + fallback determinista siguen vigilando). =off fuerza el guion fijo. Sin clave, nada.
  it("getCallDrafter: encendido POR DEFECTO con clave; =off lo apaga; sin clave, undefined", () => {
    expect(getCallDrafter({} as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(getCallDrafter({ CALL_LLM_REDACTION: "on" } as unknown as NodeJS.ProcessEnv)).toBeUndefined();
    expect(getCallDrafter({ OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv)).toBeDefined();
    expect(
      getCallDrafter({ CALL_LLM_REDACTION: "off", OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv)
    ).toBeUndefined();
    expect(getCallDrafter({ CALL_LLM_REDACTION: "on", OPENAI_API_KEY: "sk-test" } as unknown as NodeJS.ProcessEnv)).toBeDefined();
  });

  it("el prompt conversacional: lo que ella acaba de decir + temas + hechos de la llamada", () => {
    const p = buildDraftPrompt({
      brief: {
        ...brief,
        candidateUtterance: "vale pero yo no quiero salir con la cara",
        coveredTopics: ["Cómo trabaja la agencia"],
        pendingTopics: ["Reparto y cobro", "Límites y consentimiento"],
        callFacts: ["No quiere enseñar la cara."]
      },
      directiveType: "COVER_STAGE"
    });
    expect(p).toContain("ELLA ACABA DE DECIR");
    expect(p).toContain("no quiero salir con la cara");
    expect(p).toContain("Reacciona PRIMERO");
    expect(p).toContain("TEMAS YA TRATADOS");
    expect(p).toContain("Cómo trabaja la agencia");
    expect(p).toContain("TEMAS QUE QUEDAN");
    expect(p).toContain("NO los anuncies como lista");
    expect(p).toContain("No quiere enseñar la cara.");
    expect(p.toLowerCase()).toContain("no se lo vuelvas a preguntar");
  });
});
