/**
 * Model routing and fallback chains for LLM providers.
 * On non-rate-limit errors, tries the next model in the fallback chain.
 *
 * @module @clawswarm/core/utils/model-router
 */

import type { ModelId } from '../types.js';
import { createProvider } from '../providers/index.js';
import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse } from '../providers/types.js';

// ─── Fallback Chains ──────────────────────────────────────────────────────────

/**
 * Model fallback chains.
 * When the primary model fails (non-rate-limit error), the next model is tried.
 */
export const MODEL_FALLBACKS: Record<string, string[]> = {
  'gemini-pro': ['gemini-2.0-flash', 'gpt-4o-mini'],
  'gemini-flash': ['gemini-2.0-flash', 'gpt-4o-mini'],
  'gemini-2.5-flash': ['gemini-2.0-flash', 'gpt-4o-mini'],
  'gemini-2.0-flash': ['gpt-4o-mini'],
  'gpt-4o': ['gpt-4o-mini', 'gemini-2.0-flash'],
  'gpt-4o-mini': ['gemini-2.0-flash'],
  'claude-opus-4': ['claude-sonnet-4', 'gpt-4o'],
  'claude-sonnet-4': ['gpt-4o', 'gpt-4o-mini'],
};

// ─── isRateLimit ─────────────────────────────────────────────────────────────

/**
 * Returns true if the error is a rate-limit (429) — we should NOT switch models,
 * but instead retry later with the same model.
 */
export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('rate limit');
  }
  return false;
}

// ─── ModelRouter ─────────────────────────────────────────────────────────────

/**
 * Execute an LLM chat call with automatic model fallback.
 * On rate-limit errors, does NOT fall back (let the retry layer handle it).
 * On other model errors, tries the next model in the fallback chain.
 *
 * @param primaryModel - The preferred model to use
 * @param messages - Chat messages to send
 * @param options - Chat options (maxTokens, temperature, etc.)
 * @returns Chat response from whichever model succeeded
 * @throws If all models in the chain fail
 *
 * @example
 * const response = await chatWithFallback('gemini-pro', messages, { maxTokens: 8192 });
 */
export async function chatWithFallback(
  primaryModel: ModelId,
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse & { modelUsed: string }> {
  const chain = [primaryModel, ...(MODEL_FALLBACKS[primaryModel] ?? [])];

  let lastError: unknown;

  for (const model of chain) {
    try {
      const provider = await createProvider(model);
      const response = await provider.chat(messages, { ...options, model });
      return { ...response, modelUsed: model };
    } catch (err) {
      lastError = err;

      // On rate-limit, stop — don't switch models
      if (isRateLimitError(err)) {
        throw err;
      }
      // Otherwise, try next model in chain
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`All models in fallback chain failed for "${primaryModel}". Last error: ${msg}`);
}

/**
 * Get the fallback chain for a given model (includes the primary model first).
 */
export function getFallbackChain(model: ModelId): string[] {
  return [model, ...(MODEL_FALLBACKS[model] ?? [])];
}
