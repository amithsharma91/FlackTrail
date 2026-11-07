/**
 * LLM orchestrator for FlakeTrail's unified LLM architecture.
 *
 * Wraps provider access with usage tracking and optional fallback across
 * providers. All LLM calls are recorded through the shared UsageTracker so
 * retain/recall cost estimates stay consistent with Hindsight Cloud.
 */

import { UsageTracker } from '../usage';
import type {
  LLMChatOptions,
  LLMResponse,
  LLMUsage,
  OrchestratorRequest,
  OrchestratorResponse,
} from './types';
import {
  getAvailableProviders,
  getDefaultProvider,
  getProvider,
} from './registry';

/**
 * Orchestrates LLM chat completions with usage tracking and fallback.
 */
export class LLMOrchestrator {
  private usageTracker: UsageTracker;

  constructor(usageTracker?: UsageTracker) {
    this.usageTracker = usageTracker ?? new UsageTracker();
  }

  /**
   * Generate a single completion using the requested (or default) provider.
   * Throws if the named provider is unknown or the call fails.
   */
  async generate(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    const providerName = request.options?.provider;
    const provider = providerName
      ? getProvider(providerName)
      : getDefaultProvider();

    if (!provider) {
      const available = getAvailableProviders().join(', ');
      throw new Error(
        `Unknown LLM provider "${providerName ?? '(none)'}". Available: ${available}`
      );
    }

    const options: LLMChatOptions = {
      messages: request.messages,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
    };

    const response = await provider.chat(options);

    this.usageTracker.recordRetain(response.usage?.inputTokens, true);

    return {
      content: response.content,
      usage: response.usage,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      attempts: 1,
      fallbackUsed: false,
    };
  }

  /**
   * Generate a completion with automatic fallback across providers.
   * Tries the requested provider first (if any), then every other registered
   * provider in order. Records a failed retain for each attempt that errors.
   * Throws the last error if every provider fails.
   */
  async generateWithFallback(
    request: OrchestratorRequest
  ): Promise<OrchestratorResponse> {
    const preferred = request.options?.provider;
    const candidates = preferred
      ? [
          preferred,
          ...getAvailableProviders().filter((p) => p !== preferred),
        ]
      : getAvailableProviders();

    let lastError: unknown;
    let attempts = 0;

    for (const name of candidates) {
      const provider = getProvider(name);
      if (!provider) {
        continue;
      }

      attempts++;

      try {
        const options: LLMChatOptions = {
          messages: request.messages,
          temperature: request.options?.temperature,
          maxTokens: request.options?.maxTokens,
        };

        const response: LLMResponse = await provider.chat(options);

        this.usageTracker.recordRetain(response.usage?.inputTokens, true);

        return {
          content: response.content,
          usage: response.usage,
          provider: response.provider,
          model: response.model,
          latencyMs: response.latencyMs,
          attempts,
          fallbackUsed: attempts > 1,
        };
      } catch (err) {
        lastError = err;
        this.usageTracker.recordRetain(undefined, false, String(err));
        continue;
      }
    }

    throw lastError ?? new Error('All LLM providers failed');
  }

  /**
   * Return the current usage snapshot from the underlying UsageTracker.
   */
  getUsageSnapshot() {
    return this.usageTracker.getSnapshot();
  }

  /**
   * Delegate to the UsageTracker to check whether a REFLECT call is allowed.
   */
  canPerformReflect() {
    return this.usageTracker.canPerformReflect();
  }
}
