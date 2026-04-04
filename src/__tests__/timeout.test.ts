/**
 * Unit tests for LLM timeout utilities (withTimeout, withRetry, LLMTimeoutError).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, withRetry, LLMTimeoutError } from '../core/utils/timeout.js';

// ─── withTimeout ──────────────────────────────────────────────────────────────

describe('withTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const fast = Promise.resolve('done');
    const result = await withTimeout(fast, 5_000);
    expect(result).toBe('done');
  });

  it('rejects with LLMTimeoutError when promise exceeds deadline', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('late'), 200));
    await expect(withTimeout(slow, 50)).rejects.toThrow(LLMTimeoutError);
  });

  it('LLMTimeoutError carries the timeoutMs value', async () => {
    const slow = new Promise<string>(resolve => setTimeout(() => resolve('late'), 300));
    try {
      await withTimeout(slow, 50, 'test-context');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LLMTimeoutError);
      expect((err as LLMTimeoutError).timeoutMs).toBe(50);
    }
  });

  it('includes context in error message when provided', async () => {
    const slow = new Promise<never>(() => { /* never resolves */ });
    try {
      await withTimeout(slow, 50, 'GoogleProvider.chat(gemini-flash)');
    } catch (err) {
      expect((err as Error).message).toContain('GoogleProvider.chat(gemini-flash)');
    }
  });

  it('clears the timer when promise resolves quickly', async () => {
    // No dangling timers — just verify no warning is thrown
    const fast = Promise.resolve(42);
    const result = await withTimeout(fast, 10_000);
    expect(result).toBe(42);
  });

  it('propagates non-timeout rejections immediately', async () => {
    const failing = Promise.reject(new Error('LLM exploded'));
    await expect(withTimeout(failing, 5_000)).rejects.toThrow('LLM exploded');
  });

  it('works with generic typed promises', async () => {
    const p: Promise<{ data: number }> = Promise.resolve({ data: 7 });
    const result = await withTimeout(p, 1_000);
    expect(result.data).toBe(7);
  });
});

// ─── LLMTimeoutError ─────────────────────────────────────────────────────────

describe('LLMTimeoutError', () => {
  it('is an instance of Error', () => {
    const err = new LLMTimeoutError(30_000);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LLMTimeoutError);
  });

  it('name is "LLMTimeoutError"', () => {
    const err = new LLMTimeoutError(5_000);
    expect(err.name).toBe('LLMTimeoutError');
  });

  it('message includes timeout value', () => {
    const err = new LLMTimeoutError(120_000);
    expect(err.message).toContain('120000');
  });

  it('stores timeoutMs property', () => {
    const err = new LLMTimeoutError(99);
    expect(err.timeoutMs).toBe(99);
  });

  it('message includes context when given', () => {
    const err = new LLMTimeoutError(1000, 'AnthropicProvider.chat');
    expect(err.message).toContain('AnthropicProvider.chat');
  });
});

// ─── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry', () => {
  it('returns result immediately when first attempt succeeds', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds on second attempt', async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('transient'));
      return Promise.resolve('recovered');
    });

    const result = await withRetry(fn, 3, 0);
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after maxAttempts exhausted', async () => {
    const fn = vi.fn().mockImplementation(() => Promise.reject(new Error('always fails')));
    await expect(withRetry(fn, 3, 0)).rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    const fn = vi.fn().mockImplementation(() => Promise.reject(new Error('fatal')));
    const shouldRetry = vi.fn().mockReturnValue(false);

    await expect(withRetry(fn, 3, 0, shouldRetry)).rejects.toThrow('fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('shouldRetry receives error and attempt number', async () => {
    const fn = vi.fn().mockImplementation(() => Promise.reject(new Error('boom')));
    const retryLog: [unknown, number][] = [];
    const shouldRetry = (err: unknown, attempt: number) => {
      retryLog.push([err, attempt]);
      return attempt < 2;
    };

    await expect(withRetry(fn, 3, 0, shouldRetry)).rejects.toThrow();
    expect(retryLog[0][1]).toBe(1);
    expect(retryLog[1][1]).toBe(2);
  });

  it('single attempt (maxAttempts=1) never retries', async () => {
    const fn = vi.fn().mockImplementation(() => Promise.reject(new Error('once')));
    await expect(withRetry(fn, 1, 0)).rejects.toThrow('once');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
