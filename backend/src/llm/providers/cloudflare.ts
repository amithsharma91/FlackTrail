/**
 * Cloudflare Workers AI provider adapter for FlakeTrail's unified LLM architecture.
 *
 * Cloudflare Workers AI exposes a model-run REST API:
 *   POST https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/run/{model}
 *
 * The adapter never logs the API token.
 *
 * Environment variables:
 *   - CLOUDFLARE_ACCOUNT_ID   (required)
 *        Cloudflare account ID used in the request URL path.
 *   - CLOUDFLARE_API_TOKEN    (required)
 *        Bearer token sent in the `Authorization` header. Never included in
 *        error messages or logs.
 *   - CLOUDFLARE_MODEL        (optional, default: "@cf/google/gemma-4-26b-a4b-it")
 *        Model slug, e.g. "@cf/google/gemma-4-26b-a4b-it". Switched through
 *        environment configuration.
 */

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  neurons?: number;
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

const PROVIDER = 'cloudflare';
const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';
const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1024;
const REQUEST_TIMEOUT_MS = 30_000;

class CloudflareError extends Error {
  statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'CloudflareError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

function resolveAccountId(): string {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!accountId) {
    throw new CloudflareError(
      'CLOUDFLARE_ACCOUNT_ID is required but not set',
      500
    );
  }
  return accountId;
}

function resolveApiToken(): string {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!apiToken) {
    throw new CloudflareError(
      'CLOUDFLARE_API_TOKEN is required but not set',
      500
    );
  }
  // Never log or return the token itself.
  return apiToken;
}

function resolveModel(model?: string): string {
  return model ?? process.env.CLOUDFLARE_MODEL ?? DEFAULT_MODEL;
}

interface CloudflareAiRequest {
  prompt: string;
  temperature?: number;
  max_tokens?: number;
  seed?: number;
}

interface CloudflareAiUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface CloudflareAiResult {
  response?: string;
  usage?: CloudflareAiUsage;
  neurons?: number;
}

interface CloudflareAiResponse {
  result?: CloudflareAiResult;
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: string[];
}

/**
 * Build a single prompt string from the unified chat messages. Cloudflare
 * Workers AI text-generation models accept a `prompt` string rather than an
 * OpenAI-style `messages` array.
 */
function buildPrompt(messages: LLMMessage[]): string {
  return messages
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')
    .trim();
}

export class CloudflareProvider {
  readonly provider = PROVIDER;
  private readonly accountId?: string;
  private readonly model: string;

  constructor(opts: { accountId?: string; model?: string } = {}) {
    // Account ID is resolved lazily in chat() so importing the registry does
    // not fail when only another provider is configured.
    this.accountId = opts.accountId;
    this.model = resolveModel(opts.model);
  }

  /**
   * Send a non-streaming model-run request to Cloudflare Workers AI and return a
   * normalized response.
   *
   * Throws CloudflareError (with statusCode) on configuration, timeout,
   * network, or HTTP errors. The API token is never included in error messages.
   */
  async chat(opts: LLMChatOptions): Promise<LLMResponse> {
    const apiToken = resolveApiToken(); // throws if missing; token never logged
    const accountId = this.accountId ?? resolveAccountId();
    const url = `${CLOUDFLARE_API_BASE}/accounts/${accountId}/ai/run/${this.model}`;

    const body: CloudflareAiRequest = {
      prompt: buildPrompt(opts.messages),
      ...(opts.temperature !== undefined && {
        temperature: opts.temperature,
      }),
      ...(opts.maxTokens !== undefined && { max_tokens: opts.maxTokens }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const startMs = Date.now();
    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new CloudflareError(
          `Cloudflare Workers AI request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
          504
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new CloudflareError(
        `Cloudflare Workers AI request failed: ${message}`,
        502
      );
    } finally {
      clearTimeout(timeoutId);
    }

    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      let detail = '';
      try {
        const errBody = (await res.json()) as CloudflareAiResponse;
        detail =
          errBody.errors?.[0]?.message ??
          errBody.messages?.join('; ') ??
          JSON.stringify(errBody);
      } catch {
        detail = await res.text().catch(() => '');
      }
      throw new CloudflareError(
        `Cloudflare Workers AI API error (${res.status}): ${detail || res.statusText}`,
        res.status
      );
    }

    const data = (await res.json()) as CloudflareAiResponse;
    const content = data.result?.response ?? '';
    const resultUsage = data.result?.usage;
    const neurons = data.result?.neurons;

    // Extract usage when tokens are reported, or when Cloudflare reports
    // neuron consumption (available for some models) even without tokens.
    const hasUsage = resultUsage || neurons !== undefined;
    const usage = hasUsage
      ? {
          inputTokens: resultUsage?.input_tokens ?? 0,
          outputTokens: resultUsage?.output_tokens ?? 0,
          ...(neurons !== undefined && { neurons }),
        }
      : undefined;

    return {
      content,
      usage,
      provider: PROVIDER,
      model: this.model,
      latencyMs,
    };
  }
}

/**
 * Shared default provider instance built from environment configuration.
 * Suitable for direct use or as the base for provider-specific wrappers.
 */
export const cloudflareProvider = new CloudflareProvider();

/**
 * Convenience wrapper around the default provider instance.
 */
export async function chatWithCloudflare(
  opts: LLMChatOptions
): Promise<LLMResponse> {
  return cloudflareProvider.chat(opts);
}

export default CloudflareProvider;
