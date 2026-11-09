/**
 * LLM orchestrator for FlakeTrail's unified LLM architecture.
 *
 * Wraps provider access with usage tracking, transient-failure retries, and
 * fallback across the registry's configured provider order. All LLM calls are
 * recorded through the shared UsageTracker so retain/recall cost estimates stay
 * consistent with Hindsight Cloud.
 */

import { UsageTracker } from '../usage';
import type {
  LLMChatOptions,
  LLMProvider,
  LLMResponse,
  OrchestratorRequest,
  OrchestratorResponse,
} from './types';
import {
  getAvailableProviders,
  getDefaultProvider,
  getProvider,
  getProviderOrder,
} from './registry';
import {
  getLLMErrorMessage,
  getLLMErrorStatus,
  isRetryableLLMError,
} from './errors';

export interface LLMOrchestratorOptions {
  /** Maximum attempts per provider, including the first. Default: 2. */
  maxAttemptsPerProvider?: number;
  /** Delay between transient retries in milliseconds. Default: 250. */
  retryDelayMs?: number;
}

export type LLMAttemptKind = 'transport' | 'validation';

export interface LLMAttemptFailure {
  provider: string;
  kind: LLMAttemptKind;
  statusCode?: number;
  retryable: boolean;
  message: string;
}

/**
 * Raised when every provider in the fallback chain fails. The message stays
 * generic; detailed attempts are available for server-side diagnostics only.
 */
export class AllProvidersFailedError extends Error {
  readonly statusCode = 503;
  readonly attempts: LLMAttemptFailure[];

  constructor(attempts: LLMAttemptFailure[]) {
    const summary = attempts
      .map((attempt) => {
        const status = attempt.statusCode ? ` ${attempt.statusCode}` : '';
        return `${attempt.provider} (${attempt.kind}${status})`;
      })
      .join(', ');
    super(`All LLM providers failed: ${summary || 'no providers configured'}`);
    this.name = 'AllProvidersFailedError';
    this.attempts = attempts;
    Error.captureStackTrace(this, this.constructor);
  }

  /** True when every provider answered but the structured output was invalid. */
  hasOnlyValidationFailures(): boolean {
    return (
      this.attempts.length > 0 &&
      this.attempts.every((attempt) => attempt.kind === 'validation')
    );
  }
}

interface ProviderCallResult {
  response: LLMResponse;
}

/**
 * Orchestrates LLM chat completions with usage tracking and fallback.
 */
export class LLMOrchestrator {
  private usageTracker: UsageTracker;
  private maxAttemptsPerProvider: number;
  private retryDelayMs: number;

  constructor(
    usageTracker?: UsageTracker,
    options: LLMOrchestratorOptions = {}
  ) {
    this.usageTracker = usageTracker ?? new UsageTracker();
    this.maxAttemptsPerProvider = Math.max(
      1,
      options.maxAttemptsPerProvider ?? 2
    );
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 250);
  }

  /**
   * Generate a single completion using the requested (or default) provider.
   * Transient failures are retried, but this method never falls back to a
   * different provider. Throws if the provider is unknown or all attempts fail.
   */
  async generate(request: OrchestratorRequest): Promise<OrchestratorResponse> {
    await this.usageTracker.init();

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

    const { response } = await this.callProvider(provider, request);
    const result: OrchestratorResponse = {
      content: response.content,
      usage: response.usage,
      provider: response.provider,
      model: response.model,
      latencyMs: response.latencyMs,
      attempts: 1,
      fallbackUsed: false,
    };

    if (request.validate) {
      await request.validate(result);
    }

    return result;
  }

  /**
   * Generate a completion with automatic fallback across the configured
   * provider order. The requested provider (if any) is tried first, then the
   * remaining providers in registry order.
   *
   * Per-provider retries happen only for transient failures (timeouts, rate
   * limits, upstream 5xx, network errors). Authentication, invalid input, and
   * configuration failures are not retried. A provider whose response fails
   * `request.validate` is treated as unusable and the next provider is tried.
   */
  async generateWithFallback(
    request: OrchestratorRequest
  ): Promise<OrchestratorResponse> {
    await this.usageTracker.init();

    const preferred = request.options?.provider;
    if (preferred && !getProvider(preferred)) {
      const available = getAvailableProviders().join(', ');
      throw new Error(
        `Unknown LLM provider "${preferred}". Available: ${available}`
      );
    }

    const order = getProviderOrder();
    const candidates = preferred
      ? [preferred, ...order.filter((name) => name !== preferred)]
      : order;

    const failures: LLMAttemptFailure[] = [];
    let providersTried = 0;

    for (const name of candidates) {
      const provider = getProvider(name);
      if (!provider) continue;

      providersTried++;

      let call: ProviderCallResult;
      try {
        call = await this.callProvider(provider, request);
      } catch (err) {
        failures.push(this.toAttemptFailure(name, 'transport', err));
        continue;
      }

      const result: OrchestratorResponse = {
        content: call.response.content,
        usage: call.response.usage,
        provider: call.response.provider,
        model: call.response.model,
        latencyMs: call.response.latencyMs,
        attempts: providersTried,
        fallbackUsed: providersTried > 1,
      };

      if (request.validate) {
        try {
          await request.validate(result);
        } catch (err) {
          failures.push(this.toAttemptFailure(name, 'validation', err));
          continue;
        }
      }

      return result;
    }

    throw new AllProvidersFailedError(failures);
  }

  /**
   * Call one provider, retrying only transient failures. Usage is recorded on
   * a best-effort basis so a tracking problem cannot turn a valid AI response
   * into an analysis failure.
   */
  private async callProvider(
    provider: LLMProvider,
    request: OrchestratorRequest
  ): Promise<ProviderCallResult> {
    const options: LLMChatOptions = {
      messages: request.messages,
      temperature: request.options?.temperature,
      maxTokens: request.options?.maxTokens,
    };

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttemptsPerProvider; attempt++) {
      try {
        const response = await provider.chat(options);
        this.recordUsage(response.usage?.inputTokens, true);
        return { response };
      } catch (err) {
        lastError = err;
        this.recordUsage(undefined, false, getLLMErrorMessage(err));

        const canRetry =
          attempt < this.maxAttemptsPerProvider && isRetryableLLMError(err);

        if (!canRetry) break;

        if (this.retryDelayMs > 0) {
          await new Promise<void>((resolve) =>
            setTimeout(resolve, this.retryDelayMs)
          );
        }
      }
    }

    throw lastError ?? new Error(`LLM provider "${provider.provider}" failed`);
  }

  private toAttemptFailure(
    provider: string,
    kind: LLMAttemptKind,
    err: unknown
  ): LLMAttemptFailure {
    return {
      provider,
      kind,
      statusCode: getLLMErrorStatus(err),
      retryable: kind === 'transport' ? isRetryableLLMError(err) : false,
      message: getLLMErrorMessage(err),
    };
  }

  private recordUsage(
    tokenCount: number | undefined,
    success: boolean,
    error?: string
  ): void {
    try {
      this.usageTracker.recordRetain(tokenCount, success, error);
    } catch {
      // Usage tracking is best-effort; never fail an analysis because of it.
    }
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
