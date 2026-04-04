/**
 * LLM timeout utilities — race any async call against a deadline.
 * @module @clawswarm/core/utils/timeout
 */

export class LLMTimeoutError extends Error {
  public readonly timeoutMs: number;

  constructor(timeoutMs: number, context?: string) {
    const where = context ? ` (${context})` : '';
    super(`LLM call timed out after ${timeoutMs}ms${where}`);
    this.name = 'LLMTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race a promise against a timeout deadline.
 *
 * @param promise - The async operation to time-box
 * @param timeoutMs - Milliseconds before rejection
 * @param context - Optional label for the error message
 * @throws {LLMTimeoutError} if the deadline is reached first
 *
 * @example
 * const result = await withTimeout(provider.chat(messages), 30_000, 'GoogleProvider.chat');
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  context?: string
): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      reject(new LLMTimeoutError(timeoutMs, context));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

/**
 * Retry an async operation with exponential backoff.
 * Retries on any error; does NOT retry on LLMTimeoutError (caller decides).
 *
 * @param fn - Factory function that returns a promise
 * @param maxAttempts - Total attempts (1 = no retry)
 * @param baseDelayMs - Initial delay between retries (doubles each attempt)
 * @param shouldRetry - Optional predicate; if false, abort without retrying
 *
 * @example
 * const result = await withRetry(() => provider.chat(messages), 3, 500);
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
  shouldRetry: (err: unknown, attempt: number) => boolean = () => true
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === maxAttempts;
      if (isLast || !shouldRetry(err, attempt)) {
        break;
      }

      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
