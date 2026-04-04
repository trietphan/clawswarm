/**
 * Retry utilities with exponential backoff for LLM calls.
 * @module @clawswarm/core/utils/retry
 */

// ─── isRetryable ─────────────────────────────────────────────────────────────

/**
 * Determine if an error is safe to retry.
 * Retries on: 429 rate-limit, 500/503 server errors, timeout, connection reset.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('429') ||
      msg.includes('rate limit') ||
      msg.includes('500') ||
      msg.includes('503') ||
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('econnreset')
    );
  }
  return false;
}

// ─── withRetry ───────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms before first retry (default: 1000) */
  baseMs?: number;
  /** Maximum delay cap in ms (default: 30000) */
  maxMs?: number;
  /** Custom predicate to decide if an error is retryable. Defaults to isRetryable(). */
  shouldRetry?: (err: unknown) => boolean;
}

/**
 * Wrap an async function with exponential backoff retry logic.
 * Retries on transient errors (429, 500, 503, timeout, ECONNRESET).
 *
 * @param fn - Async factory that produces the operation to retry
 * @param opts - Retry configuration
 * @returns The resolved value
 *
 * @example
 * const result = await withRetry(() => provider.chat(messages), { maxRetries: 3, baseMs: 1000 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseMs = 1000,
    maxMs = 30000,
    shouldRetry = isRetryable,
  } = opts;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      if (!shouldRetry(err)) throw err;

      // Exponential backoff with jitter
      const delay = Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }

  // Unreachable, but satisfies TypeScript
  throw new Error('unreachable');
}
