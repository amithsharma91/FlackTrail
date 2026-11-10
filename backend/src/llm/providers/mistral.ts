/**
 * Mistral AI provider adapter for FlakeTrail's unified LLM architecture.
 *
 * Mistral exposes a chat completion API:
 *   POST https://api.mistral.ai/v1/chat/completions
 *
 * IMPORTANT: Mistral's published Free mode does NOT include API access.
 * API usage requires billing activation. This provider is DISABLED by
 * default and must NOT be used unless the user independently confirms
 * zero-cost API access.
 *
 * Do not activate billing. Do not add a payment method. Do not make any
 * API call that could incur a charge.
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - MISTRAL_API_KEY   (required when enabled)
 *        Bearer token sent in the `Authorization` header. Never logged.
 *   - MISTRAL_MODEL     (optional, default: "mistral-small-latest")
 *        Model id.
 *   - MISTRAL_BASE_URL  (optional, default: "https://api.mistral.ai/v1")
 *        Base URL of the Mistral API. Trailing slashes are stripped.
 *   - MISTRAL_ENABLED   (optional, default: "false")
 *        Disabled by default. Set to "true" only after confirming zero-cost API access.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LLMResponse {
  content: string;
  usage?: LLMUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

export interface LLMChatOptions {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

const PROVIDER = 'mistral';
const DEFAULT_BASE_URL = 'https://api.mistral.ai/v1';
const DEFAULT_MODEL = 'mistral-small-latest';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30_000;

class MistralError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'MistralError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new MistralError('MISTRAL_API_KEY is required but not set', 500);
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.MISTRAL_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (
    (baseUrl ?? process.env.MISTRAL_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      ''
    )
  );
}

function isEnabled(): boolean {
  return process.env.MISTRAL_ENABLED === 'true';
}

interface MistralCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface MistralErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class MistralProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming chat completion to Mistral and return a
   * normalized response.
   *
   * Throws MistralError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API key is never included in error messages.
   * Throws if the provider is disabled via MISTRAL_ENABLED=false (default).
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    if (!isEnabled()) {
      throw new MistralError(
        'Mistral provider is disabled. Mistral Free mode does not include API access. ' +
          'Enable only after confirming zero-cost API access.',
        500
      );
    }

    const apiKey = resolveApiKey(); // throws if missing; key never logged
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model: this.model,
      messages: opts.messages,
      temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const startMs = Date.now();
    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new MistralError(
          `Mistral request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new MistralError(`Mistral request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as MistralErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new MistralError(
        `Mistral API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as MistralCompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason;
    const model = data.model ?? this.model;

    // Treat empty or whitespace-only content as a validation failure so
    // the orchestrator can fall back to the next provider.
    if (!content || !content.trim()) {
      const detail = finishReason ? ` (finish_reason: ${finishReason})` : '';
      throw new MistralError(
        `Mistral returned an empty analysis response${detail}`,
        502
      );
    }

    const usage = data.usage
      ? {
          inputTokens: data.usage.prompt_tokens ?? 0,
          outputTokens: data.usage.completion_tokens ?? 0,
        }
      : undefined;

    return {
      content,
      usage,
      provider: PROVIDER,
      model,
      latencyMs,
    };
  }
}

/**
 * Shared default provider instance built from environment configuration.
 * Always constructible; chat() throws if disabled or missing credentials.
 */
export const mistralProvider = new MistralProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithMistral(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return mistralProvider.chat(opts);
}

export default MistralProvider;
