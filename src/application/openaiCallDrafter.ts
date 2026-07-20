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
  /** Solo para modelos de RAZONAMIENTO (familia 5.6 terra/luna): none|low|medium|high. Por defecto "low". */
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

/**
 * La familia gpt-5.6 (terra/luna) y posteriores son modelos de RAZONAMIENTO: rechazan `temperature` (400) y
 * aceptan `reasoning.effort`. Se detecta por nombre para construir la petición correcta. Un modelo clásico
 * (gpt-5.4/mini) mantiene EXACTAMENTE la petición de antes (temperature 0.7, sin reasoning): cero regresión.
 */
export function isReasoningCallModel(model: string): boolean {
  return /terra|luna/i.test(model) || /gpt-5\.[6-9]\b/i.test(model) || /gpt-[6-9](?:[.-]|$)/i.test(model);
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
      const reasoning = isReasoningCallModel(this.config.model);
      const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
        model: this.config.model,
        input: [{ role: "system", content: buildDraftPrompt(request) }],
        // Razonamiento: los tokens de razonamiento cuentan en max_output_tokens -> holgura para no truncar la
        // frase hablada (una frase cortada suena fatal en voz). Clásico: 220 como siempre.
        max_output_tokens: reasoning ? 400 : 220,
        truncation: "auto"
      };
      if (reasoning) {
        // effort "low" (bench 20-jul): ~2x más rápido y consistente que gpt-5.4, misma o mejor calidad.
        params.reasoning = { effort: this.config.reasoningEffort ?? "low" };
      } else {
        // 0.7 (sube de 0.5): mas variacion entre turnos = menos robotico. Seguro porque es la ruta de VOZ
        // (texto plano) y `validateCallUtterance` protege cifras/promesas. NUNCA subir asi la ruta de TEXTO
        // (usa salida estructurada JSON -> mas temperatura = mas riesgo de parse fallido).
        params.temperature = 0.7;
      }
      const response = await this.client.responses.create(params, { signal: AbortSignal.timeout(this.config.timeoutMs) });
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
  if (brief.recentBotUtterances && brief.recentBotUtterances.length > 0) {
    lines.push(
      "LO QUE TÚ YA HAS DICHO en tus últimos turnos (NO lo repitas con las mismas palabras). Si ella insiste en lo mismo, dilo MÁS CORTO y de otra forma, referéncialo con naturalidad ('como te decía', 'eso mismo') o AVANZA al siguiente punto en vez de recitarlo igual:"
    );
    for (const prev of brief.recentBotUtterances) lines.push(`- «${prev}»`);
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
      "- Eres un HOMBRE (Alex): habla de TI y del EQUIPO en masculino ('nosotros', 'encantado'), JAMÁS en femenino ('nosotras'). A ELLA trátala en femenino ('tranquila', 'encantada').",
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
  // Conversacion ENTERA de Instagram (peticion de Alex 18-jul): el bot llama sabiendo lo hablado — no
  // re-pregunta lo que ella ya conto ni contradice lo prometido. YO = el propio bot (Alex) en el DM.
  if (context.dmTranscript) {
    parts.push(`\nCONVERSACION DE INSTAGRAM (leela: no re-preguntes lo que ya conto ahi):\n${context.dmTranscript}`);
  }
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
  // Tope de tiempo por turno de VOZ (si tarda mas, cae al fallback determinista). El banco de latencia (7-jul)
  // midio gpt-5.4 en ~1.4s mediana / ~1.6s peor caso, asi que 3.5s da ~2x de margen. Configurable por
  // OPENAI_CALL_TIMEOUT_MS por si en produccion se ven fallbacks por picos de latencia.
  const rawCallTimeout = Number(env.OPENAI_CALL_TIMEOUT_MS);
  const callTimeoutMs = Number.isFinite(rawCallTimeout) && rawCallTimeout > 0 ? rawCallTimeout : 3500;
  // Esfuerzo de razonamiento para los modelos 5.6 (terra/luna). "low" por defecto (bench 20-jul: el punto
  // dulce latencia/calidad). Overridable por OPENAI_CALL_REASONING_EFFORT; ignorado por modelos clásicos.
  const effortRaw = env.OPENAI_CALL_REASONING_EFFORT?.trim().toLowerCase();
  const reasoningEffort = (["none", "low", "medium", "high"].includes(effortRaw ?? "") ? effortRaw : "low") as
    | "none"
    | "low"
    | "medium"
    | "high";
  return new OpenAiCallDrafter({
    apiKey: config.openaiApiKey,
    // Modelo de la voz: gpt-5.6-luna con reasoning=low (bench 20-jul, API directa): ~2x más rápido y
    // consistente que gpt-5.4 (sin picos de 4-7s), misma o mejor calidad y más conciso. Overridable por
    // OPENAI_CALL_MODEL (los 5.6 no aceptan temperature; el redactor lo adapta solo, ver isReasoningCallModel).
    model: config.callWritingModel,
    timeoutMs: callTimeoutMs,
    reasoningEffort
  });
}
