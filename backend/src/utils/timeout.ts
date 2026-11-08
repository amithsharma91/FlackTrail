/**
 * Timeout utility for Hindsight SDK operations.
 *
 * The installed @vectorize-io/hindsight-client SDK (v0.1.16) does not expose
 * AbortSignal or configurable request timeouts. This module provides an
 * application-level deadline wrapper using Promise.race().
 *
 * Important: this does NOT cancel the underlying HTTP operation. The promise
 * continues to run in the background; we simply stop waiting for it. The
 * timeout handle is always cleared after the promise settles.
 */

/**
 * Thrown when an operation exceeds its deadline.
 * Has a distinct code 'ETIMEDOUT' for programmatic detection.
 */
export class TimeoutError extends Error {
  readonly code = 'ETIMEDOUT';

  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
    // Restore prototype chain broken by super() call in some JS engines
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Wraps a promise with a deadline. If the promise doesn't settle before
 * `ms` milliseconds, a TimeoutError is thrown.
 *
 * @param promise - The promise to race against the deadline.
 * @param ms - Timeout in milliseconds.
 * @param options - Optional metadata (e.g. operation name for error messages).
 * @returns The resolved value of the promise if it settles before the deadline.
 * @throws TimeoutError if the deadline is reached first.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  options?: { operation?: string },
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const msg = `Operation timed out after ${ms}ms`;
      reject(
        new TimeoutError(
          options?.operation ? `${msg} (${options.operation})` : msg,
        ),
      );
    }, ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    // Always clear the timeout handle to prevent lingering timers.
    // This does not cancel the underlying operation; it just stops us waiting.
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
