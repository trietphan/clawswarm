/**
 * LLM provider factory for ClawSwarm.
 * Auto-detects provider from model name prefix.
 * @module @clawswarm/core/providers
 */

export * from './types.js';
export { GoogleProvider } from './google.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';

import type { LLMProvider } from './types.js';

/**
 * Create an LLM provider based on the model name.
 * - `claude-*` → Anthropic (requires ANTHROPIC_API_KEY)
 * - `gpt-*` → OpenAI (requires OPENAI_API_KEY)
 * - `gemini-*` → Google (requires GEMINI_API_KEY or GOOGLE_AI_API_KEY)
 *
 * @param model - Model identifier (e.g. 'gemini-pro', 'claude-sonnet-4', 'gpt-4o')
 * @returns An LLMProvider instance
 */
export async function createProvider(model: string): Promise<LLMProvider> {
  if (model.startsWith('claude-')) {
    const { AnthropicProvider } = await import('./anthropic.js');
    return new AnthropicProvider(model);
  }

  if (model.startsWith('gpt-')) {
    const { OpenAIProvider } = await import('./openai.js');
    return new OpenAIProvider(model);
  }

  if (model.startsWith('gemini-')) {
    const { GoogleProvider } = await import('./google.js');
    return new GoogleProvider(model);
  }

  // Default: pick available provider
  const hasGemini = !!(process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY);
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (hasGemini) {
    const { GoogleProvider } = await import('./google.js');
    return new GoogleProvider(model);
  }
  if (hasAnthropic) {
    const { AnthropicProvider } = await import('./anthropic.js');
    return new AnthropicProvider(model);
  }
  if (hasOpenAI) {
    const { OpenAIProvider } = await import('./openai.js');
    return new OpenAIProvider(model);
  }

  throw new Error(
    `Cannot determine provider for model "${model}". ` +
    'Set GEMINI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.'
  );
}

/**
 * Return which providers have API keys available.
 */
export function availableProviders(): string[] {
  const providers: string[] = [];
  if (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY) providers.push('google');
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  if (process.env.OPENAI_API_KEY) providers.push('openai');
  return providers;
}

/**
 * Detect which provider a model name maps to (without creating an instance).
 */
export function detectProviderName(model: string): 'anthropic' | 'openai' | 'google' | 'unknown' {
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('gemini-')) return 'google';
  return 'unknown';
}
