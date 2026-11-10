/**
 * OpenRouter provider adapter for FlakeTrail's unified LLM architecture.
 *
 * OpenRouter exposes an OpenAI-compatible chat completion API:
 *   POST {baseUrl}/chat/completions
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - OPENROUTER_API_KEY   (required)
 *        Bearer token sent in the `Authorization` header.
 *   - OPENROUTER_MODEL     (optional, default: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free")
 *        Model id, e.g. "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
 *        "openrouter/free", "anthropic/claude-3-haiku".
 *   - OPENROUTER_BASE_URL  (optional, default: "https://openrouter.ai/api/v1")
 *        Base URL of the OpenRouter API. Trailing slashes are stripped.
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

const PROVIDER = 'openrouter';
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const HTTP_REFERER = 'https://flaketrail.dev';
const X_TITLE = 'FlakeTrail';

class OpenRouterError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'OpenRouterError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new OpenRouterError(
      'OPENROUTER_API_KEY is required but not set',
      500
    );
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

interface OpenRouterCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenRouterErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class OpenRouterProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming chat completion to OpenRouter and return a
   * normalized response.
   *
   * Throws OpenRouterError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API key is never included in error messages.
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
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
          'HTTP-Referer': HTTP_REFERER,
          'X-Title': X_TITLE,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new OpenRouterError(
          `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new OpenRouterError(`OpenRouter request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as OpenRouterErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new OpenRouterError(
        `OpenRouter API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as OpenRouterCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    const model = data.model ?? this.model;

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
 * Suitable for direct use or as the base for provider-specific wrappers.
 */
export const openRouterProvider = new OpenRouterProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithOpenRouter(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return openRouterProvider.chat(opts);
}

export default OpenRouterProvider;
