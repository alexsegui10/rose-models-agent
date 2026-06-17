/**
 * Adaptador OpenAI del REDACTOR de voz: implementa `CallUtteranceDrafter` redactando la frase natural de
 * cada turno a partir del `draftingBrief` (instrucción + hechos APROBADOS + lo prohibido + contexto).
 *
 * Seguridad (capas):
 *  - El prompt fija reglas duras (frases cortas, castellano, NO inventar, NO cifras de dinero, SOLO los
 *    porcentajes que se le den) y solo entrega los hechos aprobados.
 *  - Su salida la vuelve a filtrar `validateCallUtterance` en el responder (red de seguridad).
 *  - Ante timeout/fallo devuelve null → el responder usa el `fallbackText` determinista (invariante 6).
 *  - Solo se activa con CALL_LLM_REDACTION=on y OPENAI_API_KEY presente (por defecto, APAGADO).
 *
 * El SDK de OpenAI vive aislado aquí (adaptador); el resto del código usa la interfaz CallUtteranceDrafter.
 */

import OpenAI from "openai";
import type { CallContext } from "./callContext";
import type { CallDraftRequest, CallUtteranceDrafter } from "./callDrafter";
import { getLlmRuntimeConfig } from "./llmConfig";

export interface OpenAiCallDrafterConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export class OpenAiCallDrafter implements CallUtteranceDrafter {
  private readonly client: OpenAI;

  constructor(
    private readonly config: OpenAiCallDrafterConfig,
    client?: OpenAI
  ) {
    this.client = client ?? new OpenAI({ apiKey: config.apiKey });
  }

  async draft(request: CallDraftRequest): Promise<string | null> {
    try {
      const response = await this.client.responses.create(
        {
          model: this.config.model,
          input: [{ role: "system", content: buildDraftPrompt(request) }],
          temperature: 0.5,
          max_output_tokens: 220,
          truncation: "auto"
        },
        { signal: AbortSignal.timeout(this.config.timeoutMs) }
      );
      const text = (response.output_text ?? "").trim();
      return text.length > 0 ? text : null;
    } catch {
      // Timeout o error de red/API: que hable el fallback determinista. No se lanza (no rompe el turno).
      return null;
    }
  }
}

/** Construye el prompt de sistema con la persona + los hechos aprobados + las reglas duras. */
export function buildDraftPrompt(request: CallDraftRequest): string {
  const { brief, context } = request;
  const lines: string[] = [];

  lines.push(
    "Eres el asistente de Rose Models hablando por TELÉFONO en español de ESPAÑA, cercano y natural, como una persona real."
  );
  lines.push(`OBJETIVO DE ESTE TURNO: ${brief.instruction}`);

  if (brief.groundingFacts.length > 0) {
    lines.push("APÓYATE SOLO EN ESTOS HECHOS (no inventes nada fuera de aquí):");
    for (const fact of brief.groundingFacts) lines.push(`- ${fact}`);
  }
  if (brief.mandatoryNuances.length > 0) {
    lines.push("MATICES OBLIGATORIOS:");
    for (const nuance of brief.mandatoryNuances) lines.push(`- ${nuance}`);
  }
  if (brief.prohibitedClaims.length > 0) {
    lines.push("PROHIBIDO decir:");
    for (const claim of brief.prohibitedClaims) lines.push(`- ${claim}`);
  }
  if (brief.referenceInstagram) {
    lines.push('Puedes referenciar el DM con naturalidad ("como te dije por Instagram").');
  }
  if (context) {
    lines.push(`CON QUIÉN HABLAS: ${describeContext(context)}. No le repreguntes lo que ya sabes.`);
  }

  lines.push(
    [
      "REGLAS DURAS:",
      "- Una sola idea por turno, máximo 2 frases cortas.",
      "- Termina invitando a seguir o con una pregunta natural.",
      "- NUNCA inventes datos, servicios ni cifras.",
      "- NUNCA prometas ingresos ni des cantidades de dinero.",
      "- NO menciones ningún porcentaje salvo los que aparezcan en los hechos de arriba.",
      "- Castellano de España, muletillas naturales (vale, mira, pues), sin sonar a folleto.",
      "- Responde SOLO con lo que diría el bot, sin comillas ni acotaciones."
    ].join("\n")
  );

  return lines.join("\n");
}

function describeContext(context: CallContext): string {
  const parts: string[] = [];
  if (context.candidateName) parts.push(context.candidateName);
  if (typeof context.age === "number") parts.push(`${context.age} años`);
  if (context.country) parts.push(context.country);
  if (context.concerns.length > 0) parts.push(`dudas previas: ${context.concerns.join(", ")}`);
  if (context.dmSummary) parts.push(`resumen del chat: ${context.dmSummary}`);
  return parts.join("; ") || "una candidata cualificada por Instagram";
}

/**
 * Devuelve el redactor OpenAI SOLO si está activado (CALL_LLM_REDACTION=on) y hay clave. Si no, undefined
 * → el responder usa el guion determinista (comportamiento por defecto, seguro). El timeout se acota para
 * no hacer esperar en una llamada en vivo (si tarda, cae al fallback).
 */
export function getCallDrafter(env: NodeJS.ProcessEnv = process.env): CallUtteranceDrafter | undefined {
  if (env.CALL_LLM_REDACTION !== "on") return undefined;
  const config = getLlmRuntimeConfig(env);
  if (!config.openaiApiKey) return undefined;
  return new OpenAiCallDrafter({
    apiKey: config.openaiApiKey,
    model: config.writingModel,
    timeoutMs: Math.min(config.timeoutMs, 3500)
  });
}
