/**
 * Adaptador OpenAI del REDACTOR de voz: implementa `CallUtteranceDrafter` redactando la frase natural de
 * cada turno a partir del `draftingBrief` (instrucción + hechos APROBADOS + lo prohibido + contexto).
 *
 * Seguridad (capas):
 *  - El prompt fija reglas duras (frases cortas, castellano, NO inventar, NO cifras de dinero, SOLO los
 *    porcentajes que se le den) y solo entrega los hechos aprobados.
 *  - Su salida la vuelve a filtrar `validateCallUtterance` en el responder (red de seguridad).
 *  - Ante timeout/fallo devuelve null → el responder usa el `fallbackText` determinista (invariante 6).
 *  - ACTIVO POR DEFECTO con OPENAI_API_KEY presente (decisión Alex jul-2026); CALL_LLM_REDACTION=off lo apaga.
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
          // 0.7 (sube de 0.5): mas variacion entre turnos = menos robotico. Seguro porque es la ruta de VOZ
          // (texto plano) y `validateCallUtterance` protege cifras/promesas. NUNCA subir asi la ruta de TEXTO
          // (usa salida estructurada JSON -> mas temperatura = mas riesgo de parse fallido).
          temperature: 0.7,
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

  lines.push("Eres Alex, de Rose Models, hablando por TELÉFONO en español de ESPAÑA, cercano y natural, como una persona real.");
  lines.push(`OBJETIVO DE ESTE TURNO: ${brief.instruction}`);

  // "Responde primero, luego reconduce" (jul-2026): la técnica nº1 de naturalidad. El redactor reacciona
  // a LO QUE ella acaba de decir y después cumple el objetivo del turno que fijó el director.
  if (brief.candidateUtterance) {
    lines.push(
      `ELLA ACABA DE DECIR: «${brief.candidateUtterance}». Reacciona PRIMERO a eso brevemente y con naturalidad (si aporta algo), y luego hila el objetivo del turno con suavidad. Nunca la ignores.`
    );
  }
  if (brief.callFacts && brief.callFacts.length > 0) {
    lines.push("LO QUE ELLA YA HA DICHO EN ESTA LLAMADA (no se lo vuelvas a preguntar; referéncialo si viene a cuento):");
    for (const fact of brief.callFacts) lines.push(`- ${fact}`);
  }
  if (brief.coveredTopics && brief.coveredTopics.length > 0) {
    lines.push(`TEMAS YA TRATADOS (no los repitas salvo que ella pregunte): ${brief.coveredTopics.join(", ")}.`);
  }
  if (brief.pendingTopics && brief.pendingTopics.length > 0) {
    lines.push(
      `TEMAS QUE QUEDAN (se cubren turno a turno, cada uno cuando el guion lo pida; NO los anuncies como lista): ${brief.pendingTopics.join(", ")}.`
    );
  }

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
      "- Ya ESTÁS hablando por teléfono con ella: jamás digas 'te lo explico en la llamada' ni propongas agendar una llamada.",
      "- Castellano de España, muletillas naturales (mira, oye, pues nada), sin sonar a folleto.",
      '- NO empieces la frase con "vale", "a ver", "ya" ni "pues" sueltos (a veces ya se antepone una muletilla automática).',
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
 * Devuelve el redactor OpenAI. DECISIÓN DE ALEX (jul-2026): ACTIVO POR DEFECTO cuando hay clave — el bot
 * redacta cada turno con naturalidad ("responde primero, luego reconduce"); el guion determinista queda de
 * fallback y el validador de voz filtra TODA salida (invariantes intactos). CALL_LLM_REDACTION=off fuerza
 * el guion fijo (modo seguro/pruebas). Sin clave, undefined → determinista (los tests van siempre así).
 * El timeout se acota para no hacer esperar en una llamada en vivo (si tarda, cae al fallback).
 */
export function getCallDrafter(env: NodeJS.ProcessEnv = process.env): CallUtteranceDrafter | undefined {
  if (env.CALL_LLM_REDACTION === "off") return undefined;
  const config = getLlmRuntimeConfig(env);
  if (!config.openaiApiKey) return undefined;
  return new OpenAiCallDrafter({
    apiKey: config.openaiApiKey,
    // Modelo PROPIO de la voz (mini): la subida del texto a gpt-5.4 (Alex 5-jul) NO arrastra a la
    // llamada, donde la latencia manda (cada turno debe salir en <3.5s o la llamada se siente muerta).
    model: config.callWritingModel,
    timeoutMs: Math.min(config.timeoutMs, 3500)
  });
}
