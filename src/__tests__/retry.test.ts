/**
 * Tests for the withRetry utility with exponential backoff.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, isRetryable } from '../core/utils/retry.js';

// ─── isRetryable ──────────────────────────────────────────────────────────────

describe('isRetryable', () => {
  it('returns true for 429 errors', () => {
    expect(isRetryable(new Error('HTTP 429 Too Many Requests'))).toBe(true);
  });

  it('returns true for rate limit errors', () => {
    expect(isRetryable(new Error('rate limit exceeded'))).toBe(true);
  });

  it('returns true for 500 errors', () => {
    expect(isRetryable(new Error('500 Internal Server Error'))).toBe(true);
  });

  it('returns true for 503 errors', () => {
    expect(isRetryable(new Error('503 Service Unavailable'))).toBe(true);
  });

  it('returns true for timeout errors', () => {
    expect(isRetryable(new Error('LLM call timed out'))).toBe(true);
  });

  it('returns true for econnreset errors', () => {
    expect(isRetryable(new Error('ECONNRESET socket hang up'))).toBe(true);
  });

  it('returns false for 400 bad request', () => {
    expect(isRetryable(new Error('400 Bad Request'))).toBe(false);
  });

  it('returns false for 401 unauthorized', () => {
    expect(isRetryable(new Error('401 Unauthorized'))).toBe(false);
  });

  it('returns false for 404 not found', () => {
    expect(isRetryable(new Error('404 Not Found'))).toBe(false);
  });

  it('returns false for non-Error objects', () => {
    expect(isRetryable('string error')).toBe(false);
    expect(isRetryable(null)).toBe(false);
    expect(isRetryable(42)).toBe(false);
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry (smart retry)', () => {
  it('returns result immediately when first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn, { maxRetries: 3, baseMs: 0 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on retryable error and succeeds on second attempt', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('429 rate limited');
      return 'recovered';
    });

    const result = await withRetry(fn, { maxRetries: 3, baseMs: 0 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on non-retryable error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('401 Unauthorized'));
    await expect(withRetry(fn, { maxRetries: 3, baseMs: 0 })).rejects.toThrow('401 Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('exhausts maxRetries and re-throws last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('503 Service Unavailable'));
    await expect(withRetry(fn, { maxRetries: 3, baseMs: 0 })).rejects.toThrow('503 Service Unavailable');
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it('maxRetries=0 means no retries (single attempt)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('429 rate limited'));
    await expect(withRetry(fn, { maxRetries: 0, baseMs: 0 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects custom shouldRetry predicate', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('custom retryable error'));
    const shouldRetry = vi.fn().mockReturnValue(true);

    await expect(withRetry(fn, { maxRetries: 2, baseMs: 0, shouldRetry })).rejects.toThrow();
    // shouldRetry should have been called at least once
    expect(shouldRetry).toHaveBeenCalled();
  });

  it('does not retry when custom shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fatal error'));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(fn, { maxRetries: 3, baseMs: 0, shouldRetry })).rejects.toThrow('fatal error');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on timeout errors', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('timeout occurred');
      return 'finally succeeded';
    });

    const result = await withRetry(fn, { maxRetries: 3, baseMs: 0 });
    expect(result).toBe('finally succeeded');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries on econnreset errors', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw new Error('ECONNRESET socket hang up');
      return 'reconnected';
    });

    const result = await withRetry(fn, { maxRetries: 3, baseMs: 0 });
    expect(result).toBe('reconnected');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
