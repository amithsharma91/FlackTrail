/**
 * Google Gemini provider adapter for FlakeTrail's unified LLM architecture.
 *
 * Gemini exposes the Generative Language REST API:
 *   POST {baseUrl}/models/{model}:generateContent?key={apiKey}
 *
 * The adapter never logs the API key.
 *
 * Environment variables:
 *   - GEMINI_API_KEY   (required)
 *        Sent as the `key` query parameter (Google's recommended method for
 *        the REST API). Never included in error messages or logs.
 *   - GEMINI_MODEL     (optional, default: "gemini-3.6-flash")
 *        Model id, e.g. "gemini-3.6-flash", "gemini-2.0-flash",
 *        "gemini-1.5-flash-002". Switched through environment configuration.
 *   - GEMINI_BASE_URL  (optional, default:
 *        "https://generativelanguage.googleapis.com/v1beta")
 *        Base URL of the Gemini Generative Language API. Trailing slashes
 *        are stripped.
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

const PROVIDER = 'gemini';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.6-flash';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

class GeminiError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'GeminiError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY is required but not set', 500);
  }
  // Never log or return the key itself.
  return apiKey;
}

function resolveModel(model?: string): string {
  return model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
}

function resolveBaseUrl(baseUrl?: string): string {
  return (
    (baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      ''
    )
  );
}

interface GeminiGenerateContentRequest {
  contents?: Array<{
    role: string;
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: {
    parts: Array<{ text: string }>;
  };
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string; thought?: boolean }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  modelVersion?: string;
}

interface GeminiErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
}

/**
 * Map unified chat roles to Gemini content roles. Gemini supports "user" and
 * "model"; system instructions are conveyed via `systemInstruction`.
 */
function mapRole(role: LLMMessage['role']): string {
  switch (role) {
    case 'assistant':
    case 'tool':
      return 'model';
    default:
      return 'user';
  }
}

export class GeminiProvider {
  readonly provider = PROVIDER;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: { baseUrl?: string; model?: string } = {}) {
    this.baseUrl = resolveBaseUrl(opts.baseUrl);
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming generateContent request to Google Gemini and return a
   * normalized response.
   *
   * Throws GeminiError (with statusCode) on configuration, timeout, network,
   * or HTTP errors. The API key is never included in error messages.
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const apiKey = resolveApiKey(); // throws if missing; key never logged
    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Gemini separates system instructions from the conversation history.
    const systemMessages = opts.messages.filter((m) => m.role === 'system');
    const contents = opts.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: mapRole(m.role),
        parts: [{ text: m.content }],
      }));

    const body: GeminiGenerateContentRequest = {
      contents,
      generationConfig: {
        temperature: opts.temperature ?? DEFAULT_TEMPERATURE,
        maxOutputTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      },
    };

    if (systemMessages.length > 0) {
      body.systemInstruction = {
        parts: systemMessages.map((m) => ({ text: m.content })),
      };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const startMs = Date.now();
    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new GeminiError(
          `Gemini request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new GeminiError(`Gemini request failed: ${message}`, 502);
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as GeminiErrorBody;
        detail = errBody.error?.message ?? JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new GeminiError(
        `Gemini API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const finishReason = candidate?.finishReason;

    // Gemini 3.6-flash supports thinking mode. The first part may be a
    // reasoning trace (thought: true) without any answer text. Collect text
    // from all non-thought parts so the actual answer is not missed.
    let content = '';
    for (const part of parts) {
      if (part.text && !part.thought) {
        content += part.text;
      }
    }

    // Treat empty or whitespace-only content as a validation failure so the
    // orchestrator can fall back to the next provider.
    if (!content || !content.trim()) {
      const detail = finishReason ? ` (finish_reason: ${finishReason})` : '';
      throw new GeminiError(
        `Gemini returned an empty analysis response${detail}`,
        502
      );
    }

    // MAX_TOKENS means the response was truncated mid-output; the JSON is
    // almost certainly incomplete. Treat as a validation failure so the
    // orchestrator falls back rather than attempting to parse partial JSON.
    if (finishReason === 'MAX_TOKENS') {
      throw new GeminiError(
        'Gemini response was truncated (finish_reason: MAX_TOKENS)',
        502
      );
    }

    const model = data.modelVersion ?? this.model;

    const usage = data.usageMetadata
      ? {
          inputTokens: data.usageMetadata.promptTokenCount ?? 0,
          outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
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
export const geminiProvider = new GeminiProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithGemini(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return geminiProvider.chat(opts);
}

export default GeminiProvider;
