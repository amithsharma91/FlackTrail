/**
 * Shared LLM types for FlakeTrail's unified LLM architecture.
 *
 * These interfaces normalize the surface of every LLM provider (OpenRouter,
 * Gemini, Cloudflare Workers AI) so the orchestrator and registry can treat
 * them interchangeably.
 */

/**
 * A single message in a chat conversation.
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Token usage reported by a provider after a chat completion.
 */
export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
  neurons?: number;
}

/**
 * Normalized response returned by every provider's .chat() method.
 */
export interface LLMResponse {
  content: string;
  usage?: LLMUsage;
  provider: string;
  model: string;
  latencyMs: number;
}

/**
 * Options passed to a provider's .chat() method.
 */
export interface LLMChatOptions {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * The minimal contract every LLM provider must satisfy.
 */
export interface LLMProvider {
  readonly provider: string;
  chat(opts: LLMChatOptions): Promise<LLMResponse>;
}

/**
 * Request submitted to the LLM orchestrator.
 */
export interface OrchestratorRequest {
  messages: LLMMessage[];
  options?: {
    provider?: string;
    temperature?: number;
    maxTokens?: number;
  };
}

/**
 * Response returned by the LLM orchestrator, enriched with fallback metadata.
 */
export interface OrchestratorResponse {
  content: string;
  usage?: LLMUsage;
  provider: string;
  model: string;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
}
