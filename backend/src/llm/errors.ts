/**
 * Error classification shared by the LLM orchestrator.
 *
 * Provider adapters attach an HTTP-style `statusCode` to their errors. The
 * orchestrator only retries failures that may succeed on a second attempt
 * (rate limits, timeouts, upstream 5xx / network errors). Configuration,
 * authentication, and invalid-input failures are never retried.
 */

interface ErrorWithStatus {
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  retryable?: unknown;
}

function getErrorField(err: unknown, field: keyof ErrorWithStatus): unknown {
  if (!err || typeof err !== 'object') return undefined;
  return (err as ErrorWithStatus)[field];
}

export function getLLMErrorStatus(err: unknown): number | undefined {
  const status = getErrorField(err, 'statusCode');
  return typeof status === 'number' ? status : undefined;
}

export function getLLMErrorCode(err: unknown): string | undefined {
  const code = getErrorField(err, 'code');
  return typeof code === 'string' ? code : undefined;
}

export function getLLMErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const message = getErrorField(err, 'message');
  if (typeof message === 'string') return message;
  return String(err);
}

/**
 * True when an error represents a missing/invalid provider configuration
 * rather than a transient upstream problem. Providers currently report these
 * as HTTP 500, so status alone is not enough to classify them.
 */
export function isLLMConfigurationError(err: unknown): boolean {
  const message = getLLMErrorMessage(err);
  return /(?:is required but not set|must be set|not configured|missing api key)/i.test(
    message
  );
}

/**
 * Decide whether the same provider request is worth retrying.
 */
export function isRetryableLLMError(err: unknown): boolean {
  const explicit = getErrorField(err, 'retryable');
  if (typeof explicit === 'boolean') return explicit;

  if (isLLMConfigurationError(err)) return false;

  const status = getLLMErrorStatus(err);
  if (status !== undefined) {
    // 408 request timeout, 409 conflict (rarely used by LLM APIs),
    // 425 too early, and 429 rate limit are transient.
    if (status === 408 || status === 409 || status === 425 || status === 429) {
      return true;
    }
    // 400/401/403/404/422 and other 4xx are not retryable.
    if (status >= 400 && status < 500) return false;
    // Upstream 5xx / gateway failures are retryable.
    if (status >= 500) return true;
    return false;
  }

  const code = getLLMErrorCode(err);
  if (
    code &&
    /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/i.test(
      code
    )
  ) {
    return true;
  }

  // Provider adapters wrap fetch/network failures without a status code.
  // Treat those as transient unless they were classified as configuration.
  return true;
}
