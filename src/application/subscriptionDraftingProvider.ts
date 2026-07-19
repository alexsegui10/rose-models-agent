import OpenAI from "openai";
import { promptRegistry } from "./promptRegistry";
import { buildDraftingInstructions } from "./openaiProvider";
import {
  ResponseDraftOutputSchema,
  type ResponseDraftingInput,
  type ResponseDraftingProvider,
  type ResponseDraftOutput
} from "./llmProvider";

/**
 * REDACCION VIA SUSCRIPCION (decision de Alex 19-jul): la redaccion de texto intenta PRIMERO un proxy de la
 * suscripcion ChatGPT (mismo modelo terra -> misma calidad exacta, coste 0 porque no es API medida) y, ante
 * CUALQUIER problema (limite de la suscripcion agotado, Cloudflare, deslogueo del VPS, timeout, respuesta
 * vacia/rara), cae al instante a la API oficial. Diseño A PRUEBA DE FALLOS:
 *  - El proxy es SOLO un intento; el fallback es el proveedor de API existente, 100% intacto (cero regresion).
 *  - El TEXTO que devuelve el proxy pasa despues por los MISMOS validadores del motor (factual, estilo, red
 *    determinista): un texto malo del proxy no llega a la candidata igual que no lo hace uno malo de la API.
 *  - Traza honesta (invariante 6): actualProvider dice la verdad de quien produjo el texto en cada caso.
 *  - Apagado por defecto: si no hay OPENAI_SUBSCRIPTION_BASE_URL, el factory ni crea este wrapper.
 */

/** Cliente de chat en TEXTO PLANO contra el proxy de la suscripcion (inyectable para tests). */
export interface SubscriptionChatClient {
  complete(input: {
    model: string;
    system: string;
    user: string;
    timeoutMs: number;
  }): Promise<{ text: string; inputTokens: number | null; outputTokens: number | null }>;
}

export interface SubscriptionDraftingOptions {
  /** Modelo a pedir al proxy (por defecto el writingModel, p.ej. gpt-5.6-terra). */
  model: string;
  timeoutMs: number;
  /** Cliente contra el VPS/proxy. */
  chatClient: SubscriptionChatClient;
  /** Red de seguridad: el proveedor de API oficial, usado ante cualquier fallo del proxy. */
  apiFallback: ResponseDraftingProvider;
  /** Aviso al operador (WhatsApp) cuando el proxy falla. Se llama fire-and-forget, throttled. */
  onProxyFailure?: (message: string) => void;
}

// El proxy no garantiza json_schema, asi que se le pide TEXTO PLANO. Esta coletilla evita que devuelva el
// envoltorio {"response": "..."} que si usa la API.
const PLAIN_TEXT_SUFFIX =
  "\n\nIMPORTANTE: devuelve UNICAMENTE el texto del mensaje que diria el bot, sin envoltorio JSON, sin comillas y sin ninguna explicacion.";

// Si el proxy devolvio por error un JSON {"response":"..."} (o con comillas), se extrae el texto limpio.
function extractPlainText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as { response?: unknown };
      if (typeof parsed.response === "string") return parsed.response.trim();
    } catch {
      /* no era JSON valido: se usa tal cual */
    }
  }
  // Quita comillas envolventes si el modelo entrecomillo todo el mensaje.
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 120) : "unknown";
}

// Throttle del aviso de WhatsApp: si el proxy esta caido, cada turno falla; sin esto se spamearia a Alex.
// Estado a nivel de modulo (persiste en una instancia caliente de Vercel; en frio se resetea, aceptable).
const ALERT_THROTTLE_MS = 15 * 60 * 1000;
let lastAlertAtMs = 0;

export class SubscriptionFirstDraftingProvider implements ResponseDraftingProvider {
  constructor(private readonly options: SubscriptionDraftingOptions) {}

  async draft(input: ResponseDraftingInput): Promise<ResponseDraftOutput> {
    const startedAt = Date.now();
    try {
      const result = await this.options.chatClient.complete({
        model: this.options.model,
        system: buildDraftingInstructions() + PLAIN_TEXT_SUFFIX,
        user: JSON.stringify(input),
        timeoutMs: this.options.timeoutMs
      });
      const text = extractPlainText(result.text ?? "");
      if (!text) {
        throw new Error("SUBSCRIPTION_EMPTY_OUTPUT");
      }
      // Exito por la suscripcion: mismo modelo terra, coste medido 0 (lo cubre la cuota plana).
      return ResponseDraftOutputSchema.parse({
        response: text,
        provider: "openai-subscription",
        modelVersion: this.options.model,
        promptVersion: promptRegistry.drafting.version,
        requestedProvider: "OPENAI_SUBSCRIPTION",
        actualProvider: "openai-subscription",
        requestedModel: this.options.model,
        actualModel: this.options.model,
        usedFallback: false,
        fallbackReason: null,
        durationMs: Date.now() - startedAt,
        retryCount: 0,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        // 0 (no null): "gratis por suscripcion" es un dato util para el CRM, no un desconocido.
        estimatedCostUsd: 0
      });
    } catch (error) {
      // El proxy fallo (limite/Cloudflare/deslogueo/timeout/vacio) -> API oficial. El bot NUNCA se cae.
      this.alertProxyFailure(error);
      const apiResult = await this.options.apiFallback.draft(input);
      // Traza honesta: el texto lo produjo la API (apiResult ya lo dice); se anota que se intento la
      // suscripcion antes, sin mentir sobre actualProvider. estimatedCostUsd real de la API se conserva.
      return {
        ...apiResult,
        requestedProvider: "OPENAI_SUBSCRIPTION",
        fallbackReason: `suscripcion->api: ${safeErrorName(error)}${apiResult.fallbackReason ? ` | ${apiResult.fallbackReason}` : ""}`
      };
    }
  }

  private alertProxyFailure(error: unknown): void {
    if (!this.options.onProxyFailure) return;
    const now = Date.now();
    // El throttle usa el reloj real solo para espaciar avisos; no afecta a la logica del bot.
    if (now - lastAlertAtMs < ALERT_THROTTLE_MS) return;
    lastAlertAtMs = now;
    try {
      // Fire-and-forget: el aviso jamas debe anadir latencia ni romper el turno. Se pasa SOLO el motivo
      // tecnico; el marco tranquilizador ("el bot sigue por la API, sin cortes") lo pone el formateador
      // del notificador (kind "proxy-down").
      this.options.onProxyFailure(`Motivo: ${safeErrorName(error)}`);
    } catch {
      /* un fallo del notificador nunca afecta al bot */
    }
  }
}

/** Cliente real: OpenAI SDK apuntando al proxy del VPS (endpoint compatible /v1/chat/completions). */
export function createOpenAiCompatibleSubscriptionClient(deps: { baseUrl: string; apiKey: string }): SubscriptionChatClient {
  // maxRetries: 0 (nota del revisor): failover INMEDIATO a la API si el proxy da 429/5xx, en vez de que el
  // SDK reintente 2 veces (su default) contra un proxy caido. Consistente con el redactor de API.
  const client = new OpenAI({ baseURL: deps.baseUrl, apiKey: deps.apiKey, maxRetries: 0 });
  return {
    async complete(input) {
      const response = await client.chat.completions.create(
        {
          model: input.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user }
          ]
        },
        { signal: AbortSignal.timeout(input.timeoutMs) }
      );
      return {
        text: response.choices[0]?.message?.content ?? "",
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null
      };
    }
  };
}
