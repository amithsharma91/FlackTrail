/**
 * SambaNova Cloud provider adapter for FlakeTrail's unified LLM architecture.
 *
 * SambaNova Cloud exposes a chat completion API:
 *   POST https://api.sambanova.ai/v1/chat/completions
 *
 * IMPORTANT: The published Free plan currently requires a payment method
 * and credit purchase to execute requests. This provider is DISABLED by
 * default and must NOT be used unless the user independently confirms
 * zero-cost API access.
 *
 * Do not add a payment method. Do not purchase credits. Do not make any
 * API call that could incur a charge.
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - SAMBANOVA_API_KEY   (required when enabled)
 *        Bearer token sent in the `Authorization` header. Never logged.
 *   - SAMBANOVA_MODEL     (optional, default: "Llama-4-Maverick-17B-128E-Instruct")
 *        Model id.
 *   - SAMBANOVA_BASE_URL  (optional, default: "https://api.sambanova.ai/v1")
 *        Base URL of the SambaNova API. Trailing slashes are stripped.
 *   - SAMBANOVA_ENABLED   (optional, default: "false")
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

const PROVIDER = 'sambanova';
const DEFAULT_BASE_URL = 'https://api.sambanova.ai/v1';
const DEFAULT_MODEL = 'Llama-4-Maverick-17B-128E-Instruct';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30_000;

class SambaNovaError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'SambaNovaError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey) {
    throw new SambaNovaError('SAMBANOVA_API_KEY is required but not set', 500);
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.SAMBANOVA_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (
    (baseUrl ?? process.env.SAMBANOVA_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      ''
    )
  );
}

function isEnabled(): boolean {
  return process.env.SAMBANOVA_ENABLED === 'true';
}

interface SambaNovaCompletionResponse {
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

interface SambaNovaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class SambaNovaProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming chat completion to SambaNova and return a
   * normalized response.
   *
   * Throws SambaNovaError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API key is never included in error messages.
   * Throws if the provider is disabled via SAMBANOVA_ENABLED=false (default).
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    if (!isEnabled()) {
      throw new SambaNovaError(
        'SambaNova provider is disabled. The published Free plan requires ' +
          'a payment method and credit purchase. Enable only after confirming ' +
          'zero-cost API access.',
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
        throw new SambaNovaError(
          `SambaNova request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SambaNovaError(`SambaNova request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as SambaNovaErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new SambaNovaError(
        `SambaNova API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as SambaNovaCompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason;
    const model = data.model ?? this.model;

    // Treat empty or whitespace-only content as a validation failure so
    // the orchestrator can fall back to the next provider.
    if (!content || !content.trim()) {
      const detail = finishReason ? ` (finish_reason: ${finishReason})` : '';
      throw new SambaNovaError(
        `SambaNova returned an empty analysis response${detail}`,
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
export const sambanovaProvider = new SambaNovaProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithSambaNova(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return sambanovaProvider.chat(opts);
}

export default SambaNovaProvider;
