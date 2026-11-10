/**
 * Z.AI / GLM provider adapter for FlakeTrail's unified LLM architecture.
 *
 * Z.AI exposes an OpenAI-compatible chat completion API:
 *   POST {baseUrl}/chat/completions
 *
 * Verified against Z.AI official documentation (docs.z.ai). Base URL
 * https://api.z.ai/api/paas/v4 is confirmed. This provider is enabled by
 * default under strict free mode but requires ZAI_API_KEY.
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - ZAI_API_KEY   (required)
 *        Bearer token sent in the `Authorization` header. Never logged.
 *   - ZAI_MODEL     (optional, default: "glm-4.7-flash")
 *        Model id. Verified available on Z.AI: glm-4.7-flash is free on the
 *        Z.AI API (input, cached input and output all $0). glm-4.5 was
 *        dropped from the free tier in July 2026.
 *   - ZAI_BASE_URL  (optional, default: "https://api.z.ai/api/paas/v4")
 *        Base URL of the Z.AI API. Trailing slashes are stripped.
 *   - ZAI_ENABLED   (optional, default: "true")
 *        Set to "false" to disable this provider under strict free mode.
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

const PROVIDER = 'zai';
const DEFAULT_BASE_URL = 'https://api.z.ai/api/paas/v4';
const DEFAULT_MODEL = 'glm-4.7-flash';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30_000;

class ZAIError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ZAIError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new ZAIError('ZAI_API_KEY is required but not set', 500);
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.ZAI_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? process.env.ZAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

function isEnabled(): boolean {
  return process.env.ZAI_ENABLED !== 'false';
}

interface ZAICompletionResponse {
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

interface ZAIErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class ZAIProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming chat completion to Z.AI and return a
   * normalized response.
   *
   * Throws ZAIError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API key is never included in error messages.
   * Throws if the provider is disabled via ZAI_ENABLED=false.
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    if (!isEnabled()) {
      throw new ZAIError(
        'Z.AI provider is disabled. Set ZAI_ENABLED=true to enable.',
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
        throw new ZAIError(
          `Z.AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ZAIError(`Z.AI request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as ZAIErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new ZAIError(
        `Z.AI API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as ZAICompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason;
    const model = data.model ?? this.model;

    // Treat empty or whitespace-only content as a validation failure so
    // the orchestrator can fall back to the next provider.
    if (!content || !content.trim()) {
      const detail = finishReason ? ` (finish_reason: ${finishReason})` : '';
      throw new ZAIError(
        `Z.AI returned an empty analysis response${detail}`,
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
export const zaiProvider = new ZAIProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithZAI(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return zaiProvider.chat(opts);
}

export default ZAIProvider;
