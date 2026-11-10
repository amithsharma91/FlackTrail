/**
 * NVIDIA NIM provider adapter for FlakeTrail's unified LLM architecture.
 *
 * NVIDIA NIM exposes an OpenAI-compatible chat completion API:
 *   POST {baseUrl}/chat/completions
 *
 * NVIDIA offers free prototyping access through the developer program.
 * This provider is enabled by default under strict free mode but requires
 * NVIDIA_API_KEY. The model `meta/llama-3.1-8b-instruct` is verified
 * available on NVIDIA NIM (NGC catalog + support matrix,
 * https://docs.nvidia.com/nim/large-language-models/latest/support-matrix.html).
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - NVIDIA_API_KEY   (required)
 *        Bearer token sent in the `Authorization` header. Never logged.
 *   - NVIDIA_MODEL     (optional, default: "meta/llama-3.1-8b-instruct")
 *        Model id. Verified available on NVIDIA NIM: meta/llama-3.1-8b-instruct.
 *   - NVIDIA_BASE_URL  (optional, default: "https://integrate.api.nvidia.com/v1")
 *        Base URL of the NVIDIA NIM API. Trailing slashes are stripped.
 *   - NVIDIA_ENABLED   (optional, default: "true")
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

const PROVIDER = 'nvidia';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';
const DEFAULT_MODEL = 'meta/llama-3.1-8b-instruct';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 4096;
const REQUEST_TIMEOUT_MS = 30_000;

class NVIDIAError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'NVIDIAError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    throw new NVIDIAError('NVIDIA_API_KEY is required but not set', 500);
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.NVIDIA_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (
    (baseUrl ?? process.env.NVIDIA_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      ''
    )
  );
}

function isEnabled(): boolean {
  return process.env.NVIDIA_ENABLED !== 'false';
}

interface NVIDIACompletionResponse {
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

interface NVIDIAErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
  };
}

export class NVIDIAProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming chat completion to NVIDIA NIM and return a
   * normalized response.
   *
   * Throws NVIDIAError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API key is never included in error messages.
   * Throws if the provider is disabled via NVIDIA_ENABLED=false.
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    if (!isEnabled()) {
      throw new NVIDIAError(
        'NVIDIA provider is disabled. Set NVIDIA_ENABLED=true to enable.',
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
        throw new NVIDIAError(
          `NVIDIA request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new NVIDIAError(`NVIDIA request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as NVIDIAErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new NVIDIAError(
        `NVIDIA API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as NVIDIACompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? '';
    const finishReason = choice?.finish_reason;
    const model = data.model ?? this.model;

    // Treat empty or whitespace-only content as a validation failure so
    // the orchestrator can fall back to the next provider.
    if (!content || !content.trim()) {
      const detail = finishReason ? ` (finish_reason: ${finishReason})` : '';
      throw new NVIDIAError(
        `NVIDIA returned an empty analysis response${detail}`,
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
export const nvidiaProvider = new NVIDIAProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithNVIDIA(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return nvidiaProvider.chat(opts);
}

export default NVIDIAProvider;
